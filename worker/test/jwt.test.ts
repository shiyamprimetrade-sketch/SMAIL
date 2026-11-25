import { describe, it, expect } from 'vitest';

import {
  issueAccessToken,
  verifyAccessToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL
} from '../src/services/jwt';

const secret = 'ab'.repeat(32);
const wrongSecret = 'cd'.repeat(32);
const session = 'test-session';
const now = 1800000000;

function encode(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('SMAIL JWT security', () => {

  it('uses a 15-minute access lifetime', () => {
    expect(ACCESS_TOKEN_TTL).toBe(900);
  });

  it('uses a 30-day refresh lifetime', () => {
    expect(REFRESH_TOKEN_TTL).toBe(2592000);
  });

  it('issues a three-part JWT', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifies authentic access tokens', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );

    const claims = await verifyAccessToken(
      token, secret, now
    );

    expect(claims?.sub).toBe('owner');
    expect(claims?.sid).toBe(session);
    expect(claims?.iss).toBe('smail');
    expect(claims?.aud).toBe('smail-api');
    expect(claims?.exp).toBe(now + 900);
  });

  it('rejects incorrect signing secrets', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );

    expect(await verifyAccessToken(
      token, wrongSecret, now
    )).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );

    expect(await verifyAccessToken(
      token, secret, now + 900
    )).toBeNull();
  });

  it('accepts tokens before expiration', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );

    expect(await verifyAccessToken(
      token, secret, now + 899
    )).not.toBeNull();
  });

  it('rejects future-issued tokens', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );

    expect(await verifyAccessToken(
      token, secret, now - 1
    )).toBeNull();
  });

  it('rejects unsigned tokens', async () => {
    const token = [
      encode({ alg: 'none', typ: 'JWT' }),
      encode({ sub: 'owner' }),
      ''
    ].join('.');

    expect(await verifyAccessToken(
      token, secret, now
    )).toBeNull();
  });

  it('rejects modified payloads', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );

    const parts = token.split('.');
    parts[1] = encode({ sub: 'attacker' });

    expect(await verifyAccessToken(
      parts.join('.'), secret, now
    )).toBeNull();
  });

  it('rejects modified signatures', async () => {
    const token = await issueAccessToken(
      secret, session, now
    );

    const parts = token.split('.');
    parts[2] =
      (parts[2][0] === 'A' ? 'B' : 'A') +
      parts[2].slice(1);

    expect(await verifyAccessToken(
      parts.join('.'), secret, now
    )).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyAccessToken(
      'invalid.token', secret, now
    )).toBeNull();
  });

  it('rejects oversized tokens', async () => {
    expect(await verifyAccessToken(
      'a'.repeat(4097), secret, now
    )).toBeNull();
  });

  it('rejects invalid signing secret formats', async () => {
    await expect(issueAccessToken(
      'short-secret', session, now
    )).rejects.toThrow();
  });

  it('rejects missing session identifiers', async () => {
    await expect(issueAccessToken(
      secret, '', now
    )).rejects.toThrow();
  });

  it('generates distinct token identifiers', async () => {
    const first = await issueAccessToken(
      secret, session, now
    );

    const second = await issueAccessToken(
      secret, session, now
    );

    expect(first).not.toBe(second);
  });

});
