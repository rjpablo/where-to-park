import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bytesForStorageUpload,
  decodeBase64ToArrayBuffer,
  decodeBase64ToUint8Array,
  isJpegBytes,
  stripBase64Prefix,
} from './base64.ts';

function bytesFrom(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('decodeBase64ToUint8Array', () => {
  it('decodes RFC 4648 vectors', () => {
    assert.equal(Buffer.from(decodeBase64ToUint8Array('Zg==')).toString(), 'f');
    assert.equal(Buffer.from(decodeBase64ToUint8Array('Zm8=')).toString(), 'fo');
    assert.equal(Buffer.from(decodeBase64ToUint8Array('Zm9v')).toString(), 'foo');
    assert.equal(Buffer.from(decodeBase64ToUint8Array('Zm9vYg==')).toString(), 'foob');
    assert.equal(Buffer.from(decodeBase64ToUint8Array('Zm9vYmE=')).toString(), 'fooba');
    assert.equal(Buffer.from(decodeBase64ToUint8Array('Zm9vYmFy')).toString(), 'foobar');
  });

  it('strips a data-URL prefix and whitespace', () => {
    const encoded = 'data:image/jpeg;base64,Zm9v\nYmFy';
    assert.equal(stripBase64Prefix(encoded).replace(/\s/g, ''), 'Zm9vYmFy');
    assert.equal(Buffer.from(decodeBase64ToUint8Array(encoded)).toString(), 'foobar');
  });

  it('accepts base64url', () => {
    const bytes = decodeBase64ToUint8Array('-A==');
    assert.equal(bytes[0], 248);
  });

  it('throws on garbage input', () => {
    assert.throws(() => decodeBase64ToUint8Array('$$$$'), /Cannot decode image bytes/);
  });

  it('does not need atob or Buffer.decode APIs', () => {
    const originalAtob = globalThis.atob;
    // @ts-expect-error testing Hermes-like runtime
    globalThis.atob = undefined;
    try {
      assert.equal(Buffer.from(decodeBase64ToUint8Array('Zm9v')).toString(), 'foo');
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  it('returns a standalone ArrayBuffer (no leftover offset)', () => {
    const buffer = decodeBase64ToArrayBuffer('Zm9vYmFy');
    assert.equal(buffer.byteLength, 6);
    assert.equal(Buffer.from(buffer).toString(), 'foobar');
  });

  it('recognizes JPEG SOI bytes', () => {
    const jpeg = bytesFrom([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(isJpegBytes(jpeg), true);
    assert.equal(isJpegBytes(bytesFrom([0x89, 0x50, 0x4e, 0x47])), false);
    const encoded = Buffer.from(jpeg).toString('base64');
    assert.equal(isJpegBytes(decodeBase64ToUint8Array(encoded)), true);
  });

  it('rejects tiny payloads for storage upload', () => {
    assert.throws(() => bytesForStorageUpload('Zm9v'), /Cannot decode image bytes/);
    const jpeg = Buffer.alloc(64, 0);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    const body = bytesForStorageUpload(jpeg.toString('base64'));
    assert.equal(body.byteLength, 64);
    assert.equal(new Uint8Array(body)[0], 0xff);
  });
});
