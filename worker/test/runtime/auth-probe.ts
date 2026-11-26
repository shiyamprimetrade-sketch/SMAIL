import app from '../../src/index';
import { hashPassword } from '../../src/services/crypto';
import { verifyAccessToken } from '../../src/services/jwt';
import { isSessionActive } from '../../src/services/sessions';
import type { Env } from '../../src/env';

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const checks: Record<string, boolean> = {};
    const password = 'SMAIL-synthetic-test-password';
    const secret = 'ab'.repeat(32);

    try {

      await env.DB.batch([
        env.DB.prepare('DELETE FROM refresh_tokens'),
        env.DB.prepare('DELETE FROM login_attempts'),
        env.DB.prepare('DELETE FROM login_blocks'),
        env.DB.prepare('DELETE FROM settings')
      ]);

      const testEnv: Env = {
        DB: env.DB,
        JWT_SECRET: secret,
        PASSWORD_HASH: await hashPassword(password),
        OWNER_EMAIL: 'owner@example.test'
      };

      async function post(
        path: string,
        body: unknown,
        ip = '192.0.2.100'
      ) {
        return app.request(
          'https://smail.test' + path,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'CF-Connecting-IP': ip
            },
            body: JSON.stringify(body)
          },
          testEnv
        );
      }

      const invalid = await post('/auth/login', {});

      checks.invalidRequestRejected =
        invalid.status === 400;

      const wrong = await post('/auth/login', {
        password: 'incorrect-password',
        deviceLabel: 'Test device'
      });

      checks.wrongPasswordRejected =
        wrong.status === 401;

      const login = await post('/auth/login', {
        password,
        deviceLabel: 'Test device'
      });

      checks.loginSuccessful =
        login.status === 200;

      checks.noStore =
        login.headers.get('Cache-Control') === 'no-store';

      const tokens = await login.json() as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };

      checks.accessLifetime =
        tokens.expiresIn === 900;

      checks.refreshTokenFormat =
        /^[a-f0-9]{64}$/.test(tokens.refreshToken);

      const claims = await verifyAccessToken(
        tokens.accessToken, secret
      );

      checks.accessTokenValid =
        claims !== null;

      const settings = await env.DB.prepare(`
        SELECT key, value FROM settings
      `).all<{
        key: string;
        value: string;
      }>();

      const defaults = Object.fromEntries(
        settings.results.map(
          row => [row.key, row.value]
        )
      );

      checks.settingsInitialized =
        defaults.signature === '' &&
        defaults.display_name === 'S' &&
        defaults.notifications_enabled === 'true' &&
        defaults.theme === 'dark';

      const refresh = await post('/auth/refresh', {
        refreshToken: tokens.refreshToken
      });

      checks.refreshSuccessful =
        refresh.status === 200;

      const rotated = await refresh.json() as {
        accessToken: string;
        refreshToken: string;
      };

      checks.refreshTokenRotated =
        rotated.refreshToken !== tokens.refreshToken;

      const replay = await post('/auth/refresh', {
        refreshToken: tokens.refreshToken
      });

      checks.replayRejected =
        replay.status === 401;

      const revoked = await post('/auth/refresh', {
        refreshToken: rotated.refreshToken
      });

      checks.replayRevokedReplacement =
        revoked.status === 401;

      const secondLogin = await post('/auth/login', {
        password,
        deviceLabel: 'Logout test'
      });

      const secondTokens = await secondLogin.json() as {
        accessToken: string;
        refreshToken: string;
      };

      const secondClaims = await verifyAccessToken(
        secondTokens.accessToken, secret
      );

      const logout = await post('/auth/logout', {
        refreshToken: secondTokens.refreshToken
      });

      checks.logoutSuccessful =
        logout.status === 200;

      checks.logoutRevokedSession =
        secondClaims !== null &&
        !(await isSessionActive(
          env.DB, secondClaims.sid
        ));

      let rejected = 0;

      for (let i = 0; i < 5; i++) {

        const failure = await post('/auth/login', {
          password: 'wrong-password',
          deviceLabel: 'Rate limit test'
        }, '192.0.2.200');

        if (failure.status === 401) {
          rejected++;
        }
      }

      checks.fiveFailuresRecorded =
        rejected === 5;

      const blocked = await post('/auth/login', {
        password,
        deviceLabel: 'Blocked device'
      }, '192.0.2.200');

      checks.sixthLoginBlocked =
        blocked.status === 429;

      checks.retryAfterProvided =
        Number(blocked.headers.get('Retry-After')) > 0;

      const oversized = await post('/auth/login', {
        password: 'x'.repeat(5000),
        deviceLabel: 'Oversized request'
      });

      checks.oversizedRequestRejected =
        oversized.status === 413;


      const declaredOversized = await app.request(
        'https://smail.test/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '5000',
            'CF-Connecting-IP': '192.0.2.101'
          },
          body: '{}'
        },
        testEnv
      );

      checks.declaredOversizedRejected =
        declaredOversized.status === 413;

      const malformed = await app.request(
        'https://smail.test/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '192.0.2.101'
          },
          body: '{invalid-json'
        },
        testEnv
      );

      checks.malformedJsonRejected =
        malformed.status === 400;

      const passed = Object.values(checks)
        .filter(Boolean).length;

      const total = Object.keys(checks).length;
      const ok = passed === total;

      return Response.json({
        ok,
        checks,
        passed,
        total
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
