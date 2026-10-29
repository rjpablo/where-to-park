#!/usr/bin/env node
/**
 * Local-dev API proxy.
 *
 * PostgREST in Docker cannot reach the DB on this VM, so we run PostgREST on
 * the host (:3000) and optionally mint JWTs here instead of GoTrue.
 *
 *   /rest/v1/*  -> PostgREST on 127.0.0.1:3000
 *   /auth/v1/*  -> local JWT mint for seeded users (LOCAL DEV ONLY)
 *
 * Listen: 127.0.0.1:54400
 */
const http = require('http');
const crypto = require('crypto');

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = 54400;
const POSTGREST = { host: '127.0.0.1', port: 3000 };
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const ANON_KEY =
  process.env.ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// LOCAL DEV ONLY — seeded users from supabase/seed.sql
const DEV_USERS = {
  'admin@wheretopark.local': {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@wheretopark.local',
    password: 'password123',
    role: 'authenticated',
    is_admin: true,
  },
  'maria@wheretopark.local': {
    id: '20000000-0000-0000-0000-000000000001',
    email: 'maria@wheretopark.local',
    password: 'password123',
    role: 'authenticated',
  },
  'juan@wheretopark.local': {
    id: '20000000-0000-0000-0000-000000000002',
    email: 'juan@wheretopark.local',
    password: 'password123',
    role: 'authenticated',
  },
  'sarah@wheretopark.local': {
    id: '20000000-0000-0000-0000-000000000003',
    email: 'sarah@wheretopark.local',
    password: 'password123',
    role: 'authenticated',
  },
  'staff@wheretopark.local': {
    id: '20000000-0000-0000-0000-000000000004',
    email: 'staff@wheretopark.local',
    password: 'password123',
    role: 'authenticated',
  },
};

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64url');
}

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

function mintSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = signJwt({
    iss: 'supabase-local-dev',
    aud: 'authenticated',
    role: 'authenticated',
    exp: now + 3600,
    iat: now,
    sub: user.id,
    email: user.email,
    phone: user.phone || undefined,
    aal: 'aal1',
  });
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `local-dev-${user.id}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      phone: user.phone || undefined,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: user.phone ? 'phone' : 'email', providers: [user.phone ? 'phone' : 'email'] },
      user_metadata: user.phone ? { phone: user.phone } : {},
    },
  };
}

function serviceRoleToken() {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: 'supabase-local-dev',
    role: 'service_role',
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
  });
}

function rpc(name, args, jwt) {
  const token = jwt || ANON_KEY;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args);
    const req = http.request(
      {
        host: POSTGREST.host,
        port: POSTGREST.port,
        path: `/rpc/${name}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          apikey: ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve({ error: raw || `rpc ${name} ${res.statusCode}` });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, x-client-info, x-supabase-api-version, accept-profile, content-profile, range',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Range, Range, Location',
  });
  res.end(data);
}

function handleAuth(req, res, body) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/auth/v1/health') {
    return sendJson(res, 200, { name: 'local-jwt-mint', status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return sendJson(res, 401, { message: 'No token' });
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const user =
        Object.values(DEV_USERS).find((u) => u.id === payload.sub) || {
          id: payload.sub,
          email: payload.email,
          phone: payload.phone,
        };
      if (!user.id) return sendJson(res, 401, { message: 'Unknown user' });
      return sendJson(res, 200, mintSession(user).user);
    } catch {
      return sendJson(res, 401, { message: 'Bad token' });
    }
  }

  if (req.method === 'POST' && (url.pathname === '/auth/v1/otp' || url.pathname === '/auth/v1/otp/')) {
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }
    const phone = parsed.phone || '';
    return rpc('request_phone_otp', { p_phone: phone }, serviceRoleToken())
      .then((data) => {
        if (data?.error) return sendJson(res, 400, { error: data.error, msg: data.error });
        return sendJson(res, 200, { message: 'OTP sent', phone: data.phone });
      })
      .catch((err) => sendJson(res, 502, { error: err.message }));
  }

  if (req.method === 'POST' && url.pathname === '/auth/v1/verify') {
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }
    const phone = parsed.phone || '';
    const token = parsed.token || parsed.code || '';
    return rpc('verify_phone_otp', { p_phone: phone, p_code: token }, serviceRoleToken())
      .then((data) => {
        if (!data?.success || !data.user_id) {
          return sendJson(res, 400, { error: 'invalid_otp', error_description: data?.error || 'invalid_otp' });
        }
        const digits = String(phone).replace(/[^0-9]/g, '');
        const session = mintSession({
          id: data.user_id,
          email: `${digits}@phone.wheretopark.local`,
          phone: data.phone || phone,
        });
        session.user.app_metadata.is_new = !!data.is_new;
        session.user.user_metadata.is_new = !!data.is_new;
        session.user.user_metadata.account_type = data.account_type;
        return sendJson(res, 200, session);
      })
      .catch((err) => sendJson(res, 502, { error: err.message }));
  }

  if (req.method === 'POST' && url.pathname === '/auth/v1/token') {
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = Object.fromEntries(new URLSearchParams(body));
    }
    const email = (parsed.email || '').toLowerCase();
    const password = parsed.password || '';
    const user = DEV_USERS[email];
    if (!user || user.password !== password) {
      return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    return sendJson(res, 200, mintSession(user));
  }

  if (req.method === 'POST' && url.pathname === '/auth/v1/logout') {
    return sendJson(res, 204, {});
  }

  return sendJson(res, 501, {
    message: 'Local JWT mint only handles password login. GoTrue is not running on the host.',
    path: url.pathname,
  });
}

function signStorageToken(path, sub) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: 'supabase-local-dev',
    role: 'authenticated',
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    sub,
    url: path,
  });
}

function storageBlobPath(pathname) {
  const rest = decodeURIComponent(pathname.replace(/^\/storage\/v1\/object\/sign\//, ''));
  const slash = rest.indexOf('/');
  if (slash < 0) return rest;
  return rest.slice(slash + 1);
}

function handleStorage(req, res, body) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  if (req.method === 'POST' && path.startsWith('/storage/v1/object/sign/')) {
    const objectPath = storageBlobPath(path);
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    let sub = 'anon';
    try {
      sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub || sub;
    } catch {
      sub = 'anon';
    }
    const signed = signStorageToken(objectPath, sub);
    // storage-js concatenates this onto `${supabaseUrl}/storage/v1`
    const signedURL = `/object/sign/chat-images/${objectPath}?token=${signed}`;
    return sendJson(res, 200, { signedURL, signedUrl: signedURL });
  }

  if (req.method === 'GET' && path.startsWith('/storage/v1/object/sign/')) {
    const objectPath = storageBlobPath(path);
    const token = url.searchParams.get('token') || '';
    let payload;
    try {
      payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    } catch {
      return sendJson(res, 401, { message: 'bad token' });
    }
    const userJwt = signJwt({
      iss: 'supabase-local-dev',
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: payload.sub,
    });
    return rpcAuthed('get_chat_image', { p_path: objectPath }, userJwt)
      .then((data) => {
        if (!data?.base64) return sendJson(res, 404, { error: data?.error || 'not_found' });
        const buf = Buffer.from(data.base64, 'base64');
        res.writeHead(200, {
          'Content-Type': data.content_type || 'image/png',
          'Content-Length': buf.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'private, max-age=60',
        });
        res.end(buf);
      })
      .catch((err) => sendJson(res, 502, { error: err.message }));
  }

  return sendJson(res, 404, { message: 'Storage path not found', path });
}

function rpcAuthed(name, args, jwt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args);
    const req = http.request(
      {
        host: POSTGREST.host,
        port: POSTGREST.port,
        path: `/rpc/${name}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          apikey: ANON_KEY,
          Authorization: `Bearer ${jwt}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve({ error: raw || `rpc ${name} ${res.statusCode}` });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function proxyPostgrest(req, res, body) {
  const restPath = req.url.replace(/^\/rest\/v1/, '') || '/';
  const headers = { ...req.headers, host: `${POSTGREST.host}:${POSTGREST.port}` };
  delete headers['content-length'];

  const proxyReq = http.request(
    {
      host: POSTGREST.host,
      port: POSTGREST.port,
      path: restPath,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const outHeaders = {
        ...proxyRes.headers,
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info, x-supabase-api-version, accept-profile, content-profile, range',
        'access-control-expose-headers': 'Content-Range, Range, Location',
      };
      res.writeHead(proxyRes.statusCode || 502, outHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    sendJson(res, 502, { message: 'PostgREST proxy failed', details: err.message });
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, x-client-info, x-supabase-api-version, accept-profile, content-profile, range',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    });
    return res.end();
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const path = req.url.split('?')[0];
    if (path.startsWith('/auth/v1')) return handleAuth(req, res, body.toString('utf8'));
    if (path.startsWith('/storage/v1')) return handleStorage(req, res, body.toString('utf8'));
    if (path.startsWith('/rest/v1') || path === '/rest' || path === '/') {
      if (path === '/') return sendJson(res, 200, { status: 'ok', rest: '/rest/v1', auth: '/auth/v1' });
      return proxyPostgrest(req, res, body);
    }
    sendJson(res, 404, { message: 'Not found', path });
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`Local API proxy http://${LISTEN_HOST}:${LISTEN_PORT} -> PostgREST :3000 + JWT mint`);
});
