import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

import { verifyAccessToken } from '../services/jwt';
import { isSessionActive } from '../services/sessions';

export const requireAuth: MiddlewareHandler<AppEnv> =
  async (c, next) => {

    const path = c.req.path;

    const publicRoute =
      (path === '/health' && c.req.method === 'GET') ||
      (path.startsWith('/auth/')) ||
      (path === '/webhooks/resend' &&
        c.req.method === 'POST');

    if (publicRoute) {
      await next();
      return;
    }

    c.header('Cache-Control', 'no-store');

    const unauthorized = () => {
      c.header('WWW-Authenticate', 'Bearer');

      return c.json({
        error: 'unauthorized',
        message: 'Authentication required'
      }, 401);
    };

    const authorization =
      c.req.header('Authorization');

    if (!authorization) {
      return unauthorized();
    }

    const match = /^Bearer ([^\s]+)$/i.exec(
      authorization
    );

    if (!match || match[1].length > 4096) {
      return unauthorized();
    }

    if (
      !/^[a-fA-F0-9]{64}$/.test(
        c.env.JWT_SECRET || ''
      )
    ) {
      return c.json({
        error: 'service_unavailable',
        message: 'Authentication unavailable'
      }, 500);
    }

    const claims = await verifyAccessToken(
      match[1],
      c.env.JWT_SECRET
    );

    if (!claims) {
      return unauthorized();
    }

    const active = await isSessionActive(
      c.env.DB,
      claims.sid
    );

    if (!active) {
      return unauthorized();
    }

    await next();
  };
