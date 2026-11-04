# Where To Park - Baguio Parking Finder

A modern parking finder app for Baguio City, Philippines. Built with Expo (React Native), Supabase (PostGIS), and MapLibre.

## Features

- **Real-time parking availability** with PostGIS location search
- **MapLibre GL** for interactive maps on native and web
- **Walk-in check-in** flow for staff
- **Dynamic pricing** with custom rates, time slots, and area-based pricing
- **Folio ledger system** for charges, payments, and waivers
- **Admin verification** queue for user-submitted locations

## Local Development

### Prerequisites
- Node.js 18+
- Docker
- Supabase CLI

### Setup

```bash
# Install dependencies
npm install

# Start the Postgres container (other Supabase services are unused on this VM)
supabase start --ignore-health-check

# Apply schema + seed with ON_ERROR_STOP (do not use `supabase db reset` here)
./scripts/reset-local-db.sh

# Host PostgREST (Docker PostgREST cannot reach the DB on this VM)
# binary from GitHub releases; config in /tmp/postgrest.conf in this environment
./postgrest postgrest.conf   # listen :3000

# Tiny proxy: /rest/v1 -> :3000, /auth/v1 -> local JWT mint (dev only)
node scripts/local-api-proxy.js   # listen :54400

# Point the app at the proxy
# EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400

npx expo start --web --port 19006 --clear
```

### Local Dev Troubleshooting

**Issue: PostgREST container cannot connect to database (timeout)**

This is a known issue in some VM environments where PostgREST inside Docker cannot reach the database container despite both being on the same network.

**Workaround:** Run PostgREST locally on the host:

```bash
# Download PostgREST
wget https://github.com/PostgREST/postgrest/releases/download/v12.0.1/postgrest-v12.0.1-linux-static-x64.tar.xz
tar -xf postgrest-v12.0.1-linux-static-x64.tar.xz
chmod +x postgrest

# Create config file
cat > postgrest.conf <<EOF
db-uri = "postgres://authenticator:postgres@127.0.0.1:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-host = "127.0.0.1"
server-port = 3000
jwt-secret = "super-secret-jwt-token-with-at-least-32-characters-long"
EOF

# Run PostgREST
./postgrest postgrest.conf

# Update .env.local to point to local PostgREST
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:3000
```

**Issue: Local proxy has no Storage upload API**

`scripts/local-api-proxy.js` only implements signed GET for `chat-images` (via `chat_image_blobs`). There is no `storage.from(...).upload()` on the proxy.

- Chat photos fall back to `put_chat_image` BYTEA storage, then `get_chat_image` / signed URLs.
- Location photos record a `location_photos` path only. Public URLs work against hosted Storage, not the local proxy.

**Issue: `supabase db reset` times out**

The Supabase CLI `db reset` command tries to connect through Kong/PostgREST, which has the timeout issue above.

**Workaround:** `./scripts/reset-local-db.sh` drops `public`, applies every migration with `ON_ERROR_STOP=1`, then seeds. Seeded logins (local JWT mint, not production):

- admin@wheretopark.local / password123
- juan@wheretopark.local / password123 (Session Road owner)
- maria@wheretopark.local / password123 (SM owner; Casa Vallejo staff, `staff_can_waive=false`)
- staff@wheretopark.local / password123 (Session Road staff)

## Testing

```bash
# Direct DB tests (bypasses PostgREST)
node scripts/test-db-direct.js

# pgTAP tests (requires pgtap extension)
docker exec supabase_db_workspace psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pgtap"
npm run test:db

# Parallel concurrency test
./scripts/parallel-concurrency-test.sh
```

## Database

- **4 verified locations**: SM City Baguio, Session Road Park n Ride, Casa Vallejo, Pine Ridge Driveway
- **1 unverified location**: Burnham Park Street Parking
- **PostGIS** for spatial queries (nearest parking within radius)
- **Row Level Security** policies per role (anon, driver, staff, operator, admin)
- **34 RLS policies** enforcing data access boundaries
- **11 RPCs** for business logic (search_nearby, quote_price, claim_capacity, etc.)

## Architecture

```
├── app/              # Expo Router screens
├── src/
│   ├── components/   # React components
│   ├── lib/          # Supabase client, theme
│   └── utils/        # Formatters, helpers
├── supabase/
│   ├── migrations/   # Database schema
│   └── seed.sql      # Test data
└── scripts/          # Test and capture scripts
```

## License

MIT
