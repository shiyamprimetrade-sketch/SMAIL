import {
  createSession,
  rotateSession,
  revokeSession,
  isSessionActive
} from '../../src/services/sessions';

import {
  verifyAccessToken
} from '../../src/services/jwt';

import { sha256 } from '../../src/services/crypto';

interface Env {
  DB: D1Database;
}

const secret = 'ab'.repeat(32);

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const checks: Record<string, boolean> = {};

    try {
      await env.DB.prepare(
        'DELETE FROM refresh_tokens'
      ).run();

      const first = await createSession(
        env.DB, secret
      );

      const claims = await verifyAccessToken(
        first.accessToken, secret
      );

      checks.sessionCreated = claims !== null;

      if (!claims) {
        throw new Error('Invalid access token');
      }

      checks.sessionActive = await isSessionActive(
        env.DB, claims.sid
      );

      const stored = await env.DB.prepare(`
        SELECT token_hash FROM refresh_tokens
        WHERE device_id = ?
      `).bind(claims.sid).first<{
        token_hash: string
      }>();

      checks.hashOnly =
        stored?.token_hash ===
        await sha256(first.refreshToken) &&
        stored?.token_hash !== first.refreshToken;

      const rotated = await rotateSession(
        env.DB, secret, first.refreshToken
      );

      checks.rotationSuccessful =
        rotated.status === 'ok';

      if (rotated.status !== 'ok') {
        throw new Error('Rotation failed');
      }

      checks.tokenChanged =
        rotated.tokens.refreshToken !==
        first.refreshToken;

      const rotatedClaims =
        await verifyAccessToken(
          rotated.tokens.accessToken,
          secret
        );

      checks.sessionPreserved =
        rotatedClaims?.sid === claims.sid;

      const second = await createSession(
        env.DB, secret
      );

      const secondClaims =
        await verifyAccessToken(
          second.accessToken, secret
        );

      if (!secondClaims) {
        throw new Error('Invalid second session');
      }

      const replay = await rotateSession(
        env.DB, secret, first.refreshToken
      );

      checks.replayDetected =
        replay.status === 'replay';

      checks.globalRevocation =
        !(await isSessionActive(
          env.DB, claims.sid
        )) &&
        !(await isSessionActive(
          env.DB, secondClaims.sid
        ));

      const logout = await createSession(
        env.DB, secret
      );

      const logoutClaims =
        await verifyAccessToken(
          logout.accessToken, secret
        );

      if (!logoutClaims) {
        throw new Error('Invalid logout session');
      }

      await revokeSession(
        env.DB, logout.refreshToken
      );

      checks.logoutSuccessful =
        !(await isSessionActive(
          env.DB, logoutClaims.sid
        ));

      const concurrent = await createSession(
        env.DB, secret
      );

      const results = await Promise.all([
        rotateSession(
          env.DB,
          secret,
          concurrent.refreshToken
        ),
        rotateSession(
          env.DB,
          secret,
          concurrent.refreshToken
        )
      ]);

      checks.singleRotationWinner =
        results.filter(
          result => result.status === 'ok'
        ).length === 1;

      checks.concurrentReplayDetected =
        results.filter(
          result => result.status === 'replay'
        ).length === 1;

      const active = await env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM refresh_tokens
        WHERE revoked = 0
      `).first<{ count: number }>();

      checks.concurrentRevocation =
        active?.count === 0;

      const invalid = await rotateSession(
        env.DB, secret, 'invalid-token'
      );

      checks.invalidTokenRejected =
        invalid.status === 'invalid';

      const ok = Object.values(checks)
        .every(Boolean);

      return Response.json({
        ok,
        checks,
        passed: Object.values(checks)
          .filter(Boolean).length,
        total: Object.keys(checks).length
      }, {
        status: ok ? 200 : 500
      });

    } catch (error) {
      return Response.json({
        ok: false,
        checks,
        error: String(error)
      }, {
        status: 500
      });
    }
  }
};
