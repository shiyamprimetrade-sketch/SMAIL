import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { AppEnv } from '../env';

import { verifyPassword } from '../services/crypto';

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

auth.use('*', bodyLimit({
  maxSize: 4096,
  onError: c => c.json({
    error: 'payload_too_large',
    message: 'Request too large'
  }, 413)
}));

async function readObject(
  request: Request
): Promise<Record<string, unknown> | null> {

  try {
    const value: unknown = await request.json();

    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      return null;
    }

    return value as Record<string, unknown>;

  } catch {
    return null;
  }
}

auth.post('/login', async c => {

  const body = await readObject(c.req.raw);

  if (
    !body ||
    typeof body.password !== 'string' ||
    body.password.length === 0 ||
    new TextEncoder().encode(body.password).length > 1024 ||
    typeof body.deviceLabel !== 'string' ||
    body.deviceLabel.trim().length === 0 ||
    body.deviceLabel.length > 128
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
    !c.env.PASSWORD_HASH ||
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

  const verified = await verifyPassword(
    body.password,
    c.env.PASSWORD_HASH
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
    c.env.JWT_SECRET
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
