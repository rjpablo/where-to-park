const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < TABLE.length; i += 1) LOOKUP[TABLE.charCodeAt(i)] = i;

export const JPEG_SOI = [0xff, 0xd8, 0xff] as const;

export function stripBase64Prefix(value: string): string {
  return (value || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
}

export function isJpegBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === JPEG_SOI[0] &&
    bytes[1] === JPEG_SOI[1] &&
    bytes[2] === JPEG_SOI[2]
  );
}

/**
 * Decode standard/base64url payload to bytes without Buffer or atob.
 * Those globals are missing on React Native Hermes (Android release).
 */
export function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const clean = stripBase64Prefix(base64).replace(/-/g, '+').replace(/_/g, '/');
  if (!clean) throw new Error('Cannot decode image bytes');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) {
    throw new Error('Cannot decode image bytes');
  }

  const len = padded.length;
  const output = new Uint8Array(((len * 3) / 4) | 0);
  let outIndex = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = LOOKUP[padded.charCodeAt(i)];
    const c1 = LOOKUP[padded.charCodeAt(i + 1)];
    const c2 = LOOKUP[padded.charCodeAt(i + 2)];
    const c3 = LOOKUP[padded.charCodeAt(i + 3)];
    output[outIndex] = (c0 << 2) | (c1 >> 4);
    outIndex += 1;
    if (padded[i + 2] !== '=') {
      output[outIndex] = ((c1 & 15) << 4) | (c2 >> 2);
      outIndex += 1;
    }
    if (padded[i + 3] !== '=') {
      output[outIndex] = ((c2 & 3) << 6) | c3;
      outIndex += 1;
    }
  }
  return output.subarray(0, outIndex);
}

export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = decodeBase64ToUint8Array(base64);
  if (bytes.byteLength < 1) throw new Error('Cannot decode image bytes');
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function bytesForStorageUpload(base64: string): ArrayBuffer {
  const buffer = decodeBase64ToArrayBuffer(base64);
  if (buffer.byteLength < 32) throw new Error('Cannot decode image bytes');
  return buffer;
}
