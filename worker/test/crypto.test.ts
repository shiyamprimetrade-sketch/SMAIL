import { describe, it, expect } from 'vitest';

import {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  PASSWORD_ITERATIONS
} from '../src/services/crypto';

const password = 'SMAIL-test-password-2026';

describe('SMAIL cryptographic engine', () => {

  it('uses required iteration count', () => {
    expect(PASSWORD_ITERATIONS)
      .toBeGreaterThanOrEqual(210000);
  });

  it('hashes and verifies a password', async () => {
    const hash = await hashPassword(password);

    expect(hash).not.toContain(password);

    expect(await verifyPassword(password, hash))
      .toBe(true);
  });

  it('rejects incorrect passwords', async () => {
    const hash = await hashPassword(password);

    expect(await verifyPassword('wrong-password', hash))
      .toBe(false);
  });

  it('generates unique password salts', async () => {
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
  });

  it('rejects short passwords', async () => {
    await expect(hashPassword('short'))
      .rejects.toThrow();
  });

  it('rejects oversized passwords', async () => {
    await expect(hashPassword('a'.repeat(1025)))
      .rejects.toThrow();
  });

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword(password, 'invalid'))
      .toBe(false);
  });

  it('rejects weak iteration counts', async () => {
    const hash = await hashPassword(password);
    const weak = hash.replace('$210000$', '$1000$');

    expect(await verifyPassword(password, weak))
      .toBe(false);
  });

  it('rejects excessive iteration counts', async () => {
    const hash = await hashPassword(password);
    const invalid = hash.replace(
      '$210000$', '$999999999$'
    );

    expect(await verifyPassword(password, invalid))
      .toBe(false);
  });

  it('rejects corrupted hexadecimal hashes', async () => {
    const hash = await hashPassword(password);
    const parts = hash.split('$');
    parts[3] = 'z'.repeat(64);

    expect(await verifyPassword(password, parts.join('$')))
      .toBe(false);
  });

  it('generates 256-bit random tokens', () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates distinct random tokens', () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => randomToken())
    );

    expect(tokens.size).toBe(100);
  });

  it('rejects invalid token sizes', () => {
    expect(() => randomToken(1)).toThrow();
  });

  it('matches the SHA-256 reference vector', async () => {
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223' +
      'b00361a396177a9cb410ff61f20015ad'
    );
  });

});
