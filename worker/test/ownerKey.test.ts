import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  OWNER_KEY_BYTES,
  OWNER_KEY_LENGTH,
  generateOwnerKey,
  isOwnerKey,
  hashOwnerKey,
  verifyOwnerKey
} from '../src/services/ownerKey';

describe('SMAIL owner key authentication', () => {
  const syntheticKey = 'ab'.repeat(32);

  it('requires 256-bit keys', () => {
    expect(OWNER_KEY_BYTES).toBe(32);
  });

  it('requires 64 hexadecimal characters', () => {
    expect(OWNER_KEY_LENGTH).toBe(64);
  });

  it('generates a valid owner key', () => {
    expect(isOwnerKey(generateOwnerKey())).toBe(true);
  });

  it('generates distinct keys', () => {
    const keys = Array.from(
      { length: 100 },
      () => generateOwnerKey()
    );

    expect(new Set(keys).size).toBe(100);
  });

  it('rejects ordinary passwords', () => {
    expect(isOwnerKey('password123')).toBe(false);
  });

  it('rejects short keys', () => {
    expect(isOwnerKey('ab'.repeat(31))).toBe(false);
  });

  it('rejects oversized keys', () => {
    expect(isOwnerKey('ab'.repeat(33))).toBe(false);
  });

  it('rejects non-hexadecimal characters', () => {
    expect(isOwnerKey('z'.repeat(64))).toBe(false);
  });

  it('rejects uppercase hexadecimal', () => {
    expect(isOwnerKey('AB'.repeat(32))).toBe(false);
  });

  it('rejects whitespace', () => {
    expect(isOwnerKey(syntheticKey + ' ')).toBe(false);
  });

  it('rejects trailing newline', () => {
    expect(isOwnerKey(syntheticKey + '\n')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isOwnerKey(null)).toBe(false);
    expect(isOwnerKey(123)).toBe(false);
    expect(isOwnerKey({})).toBe(false);
  });

  it('produces a 256-bit SHA-256 digest', async () => {
    const digest = await hashOwnerKey(syntheticKey);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches independent Node SHA-256', async () => {
    const expected = createHash('sha256')
      .update(syntheticKey, 'utf8')
      .digest('hex');

    expect(await hashOwnerKey(syntheticKey))
      .toBe(expected);
  });

  it('accepts the correct owner key', async () => {
    const hash = await hashOwnerKey(syntheticKey);

    expect(await verifyOwnerKey(syntheticKey, hash))
      .toBe(true);
  });

  it('rejects an incorrect owner key', async () => {
    const hash = await hashOwnerKey(syntheticKey);

    expect(await verifyOwnerKey('cd'.repeat(32), hash))
      .toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyOwnerKey(syntheticKey, 'bad'))
      .toBe(false);
  });

  it('rejects malformed supplied keys', async () => {
    const hash = await hashOwnerKey(syntheticKey);

    expect(await verifyOwnerKey('password', hash))
      .toBe(false);
  });

  it('rejects invalid key hashing', async () => {
    await expect(hashOwnerKey('password'))
      .rejects.toThrow();
  });

  it('rejects missing credentials', async () => {
    expect(await verifyOwnerKey(undefined, undefined))
      .toBe(false);
  });
});
