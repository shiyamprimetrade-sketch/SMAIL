import { Hono } from 'hono';

import type { AppEnv } from '../env';

import {
  isOwnerKey,
  verifyOwnerKey
} from '../services/ownerKey';

import {
  createSession,
  rotateSession,
  revokeSession
} from '../services/sessions';

import {
  reserveLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess
} from '../middleware/rateLimit';

export const auth = new Hono<AppEnv>();

auth.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});


const MAX_AUTH_BODY = 4096;

class PayloadTooLarge extends Error {}

async function readObject(
  request: Request
): Promise<Record<string, unknown> | null> {

  const declared = request.headers.get(
    'Content-Length'
  );

  if (
    declared !== null &&
    Number(declared) > MAX_AUTH_BODY
  ) {
    throw new PayloadTooLarge();
  }

  if (!request.body) {
    return null;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {

    while (true) {

      const { done, value } = await reader.read();

      if (done) break;

      total += value.byteLength;

      if (total > MAX_AUTH_BODY) {

        await reader.cancel().catch(() => {});

        throw new PayloadTooLarge();
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(total);

    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const decoded = new TextDecoder(
      'utf-8'
    ).decode(bytes);

    const encoded = new TextEncoder()
      .encode(decoded);

    if (
      encoded.length !== bytes.length ||
      encoded.some(
        (byte, index) => byte !== bytes[index]
      )
    ) {
      return null;
    }

    const value: unknown = JSON.parse(decoded);

    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      return null;
    }

    return value as Record<string, unknown>;

  } catch (error) {

    if (error instanceof PayloadTooLarge) {
      throw error;
    }

    return null;

  } finally {
    reader.releaseLock();
  }
}

auth.onError((error, c) => {

  c.header('Cache-Control', 'no-store');

  if (error instanceof PayloadTooLarge) {
    return c.json({
      error: 'payload_too_large',
      message: 'Request too large'
    }, 413);
  }

  return c.json({
    error: 'internal_error',
    message: 'Internal server error'
  }, 500);
});

auth.post('/login', async c => {

  const body = await readObject(c.req.raw);

  if (
    !body ||
    !isOwnerKey(body.ownerKey) ||
    Object.keys(body).length !== 2 ||
    typeof body.deviceLabel !== 'string' ||
    body.deviceLabel.trim().length === 0 ||
    body.deviceLabel.length > 128 ||
    /[\x00-\x1f\x7f]/.test(body.deviceLabel)
  ) {
    return c.json({
      error: 'invalid_request',
      message: 'Invalid login request'
    }, 400);
  }

  const ip = c.req.header('CF-Connecting-IP');

  if (!ip || ip.length > 64) {
    return c.json({
      error: 'forbidden',
      message: 'Request origin unavailable'
    }, 403);
  }

  if (
    !isOwnerKey(c.env.OWNER_KEY_HASH) ||
    !/^[a-fA-F0-9]{64}$/.test(c.env.JWT_SECRET || '')
  ) {
    return c.json({
      error: 'service_unavailable',
      message: 'Authentication unavailable'
    }, 500);
  }

  const reservation = await reserveLoginAttempt(
    c.env.DB, ip
  );

  if (!reservation.allowed) {

    c.header(
      'Retry-After',
      String(reservation.retryAfter)
    );

    return c.json({
      error: 'rate_limited',
      message: 'Too many login attempts'
    }, 429);
  }

  const verified = await verifyOwnerKey(
    body.ownerKey,
    c.env.OWNER_KEY_HASH
  );

  if (!verified) {

    await recordLoginFailure(
      c.env.DB,
      ip,
      reservation.attemptId
    );

    return c.json({
      error: 'invalid_credentials',
      message: 'Invalid credentials'
    }, 401);
  }

  await recordLoginSuccess(
    c.env.DB,
    ip,
    reservation.attemptId
  );

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO settings
      (key, value) VALUES ('signature', '')
    `),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO settings
      (key, value) VALUES ('display_name', 'S')
    `),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO settings
      (key, value)
      VALUES ('notifications_enabled', 'true')
    `),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO settings
      (key, value) VALUES ('theme', 'dark')
    `)
  ]);

  const tokens = await createSession(
    c.env.DB,
    c.env.JWT_SECRET,
    body.deviceLabel.trim()
  );

  return c.json(tokens);
});

auth.post('/refresh', async c => {

  const body = await readObject(c.req.raw);

  if (
    !body ||
    typeof body.refreshToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.refreshToken)
  ) {
    return c.json({
      error: 'invalid_request',
      message: 'Invalid refresh request'
    }, 400);
  }

  const result = await rotateSession(
    c.env.DB,
    c.env.JWT_SECRET,
    body.refreshToken
  );

  if (result.status !== 'ok') {
    return c.json({
      error: 'invalid_session',
      message: 'Authentication required'
    }, 401);
  }

  return c.json(result.tokens);
});

auth.post('/logout', async c => {

  const body = await readObject(c.req.raw);

  if (
    !body ||
    typeof body.refreshToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.refreshToken)
  ) {
    return c.json({
      error: 'invalid_request',
      message: 'Invalid logout request'
    }, 400);
  }

  await revokeSession(
    c.env.DB,
    body.refreshToken
  );

  return c.json({ ok: true });
});
