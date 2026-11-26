import { issueAccessToken } from '../../src/services/jwt';
import app from '../../src/index';
import { hashOwnerKey } from '../../src/services/ownerKey';
import { verifyAccessToken } from '../../src/services/jwt';
import { isSessionActive } from '../../src/services/sessions';
import type { Env } from '../../src/env';

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const checks: Record<string, boolean> = {};
    const ownerKey = '12'.repeat(32);
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
        OWNER_KEY_HASH: await hashOwnerKey(ownerKey),
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
        ownerKey: '34'.repeat(32),
        deviceLabel: 'Test device'
      });

      checks.wrongOwnerKeyRejected =
        wrong.status === 401;

      const login = await post('/auth/login', {
        ownerKey,
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

      const deviceClaims = await verifyAccessToken(
        tokens.accessToken,
        secret
      );

      const deviceRows = await env.DB.prepare(`
        SELECT device_label, revoked
        FROM refresh_tokens
        WHERE device_id = ?
      `).bind(
        deviceClaims?.sid ?? ''
      ).all<{
        device_label: string;
        revoked: number;
      }>();

      checks.deviceLabelPersisted =
        deviceRows.results.some(
          row =>
            row.revoked === 1 &&
            row.device_label === 'Test device'
        );

      checks.deviceLabelPreservedOnRotation =
        deviceRows.results.some(
          row =>
            row.revoked === 0 &&
            row.device_label === 'Test device'
        );

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
        ownerKey,
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
          ownerKey: '56'.repeat(32),
          deviceLabel: 'Rate limit test'
        }, '192.0.2.200');

        if (failure.status === 401) {
          rejected++;
        }
      }

      checks.fiveFailuresRecorded =
        rejected === 5;

      const blocked = await post('/auth/login', {
        ownerKey,
        deviceLabel: 'Blocked device'
      }, '192.0.2.200');

      checks.sixthLoginBlocked =
        blocked.status === 429;

      checks.retryAfterProvided =
        Number(blocked.headers.get('Retry-After')) > 0;

      const oversized = await post('/auth/login', {
        ownerKey: 'x'.repeat(5000),
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


      const authorizationLogin = await post(
        '/auth/login',
        {
          ownerKey,
          deviceLabel: 'Authorization test'
        },
        '192.0.2.110'
      );

      const authorizationTokens =
        await authorizationLogin.json() as {
          accessToken: string;
          refreshToken: string;
        };

      async function protectedRequest(
        token?: string,
        path = '/messages'
      ) {

        const headers: Record<string, string> = {};

        if (token !== undefined) {
          headers.Authorization = token;
        }

        return app.request(
          'https://smail.test' + path,
          { method: 'GET', headers },
          testEnv
        );
      }

      const health = await protectedRequest(
        undefined, '/health'
      );

      checks.publicHealthAccessible =
        health.status === 200;

      const missing = await protectedRequest();

      checks.missingTokenRejected =
        missing.status === 401;

      checks.bearerChallengeProvided =
        missing.headers.get(
          'WWW-Authenticate'
        ) === 'Bearer';

      checks.privateResponseNotCached =
        missing.headers.get(
          'Cache-Control'
        ) === 'no-store';

      const malformedToken =
        await protectedRequest('Bearer invalid');

      checks.malformedTokenRejected =
        malformedToken.status === 401;

      const wrongScheme = await protectedRequest(
        'Basic ' + authorizationTokens.accessToken
      );

      checks.wrongSchemeRejected =
        wrongScheme.status === 401;

      const valid = await protectedRequest(
        'Bearer ' + authorizationTokens.accessToken
      );

      checks.validTokenAccepted =
        valid.status === 404;

      const parts =
        authorizationTokens.accessToken.split('.');

      parts[2] =
        (parts[2][0] === 'A' ? 'B' : 'A') +
        parts[2].slice(1);

      const forged = await protectedRequest(
        'Bearer ' + parts.join('.')
      );

      checks.forgedTokenRejected =
        forged.status === 401;

      const authorizationClaims =
        await verifyAccessToken(
          authorizationTokens.accessToken,
          secret
        );

      if (!authorizationClaims) {
        throw new Error(
          'Authorization test session unavailable'
        );
      }

      const expiredToken = await issueAccessToken(
        secret,
        authorizationClaims.sid,
        Math.floor(Date.now() / 1000) - 901
      );

      const expired = await protectedRequest(
        'Bearer ' + expiredToken
      );

      checks.expiredTokenRejected =
        expired.status === 401;

      await post('/auth/logout', {
        refreshToken:
          authorizationTokens.refreshToken
      });

      const revokedAccess = await protectedRequest(
        'Bearer ' + authorizationTokens.accessToken
      );

      checks.revokedAccessTokenRejected =
        revokedAccess.status === 401;


      const settingsLogin = await post(
        '/auth/login',
        {
          ownerKey,
          deviceLabel: 'Settings test'
        },
        '192.0.2.120'
      );

      const settingsTokens =
        await settingsLogin.json() as {
          accessToken: string;
          refreshToken: string;
        };

      async function settingsRequest(
        method: string,
        body?: unknown,
        authenticated = true
      ) {

        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };

        if (authenticated) {
          headers.Authorization =
            'Bearer ' + settingsTokens.accessToken;
        }

        return app.request(
          'https://smail.test/settings',
          {
            method,
            headers,
            body: body === undefined
              ? undefined
              : JSON.stringify(body)
          },
          testEnv
        );
      }

      const initialSettings =
        await settingsRequest('GET');

      checks.settingsGetSuccessful =
        initialSettings.status === 200;

      const initialValues =
        await initialSettings.json() as {
          signature: string;
          displayName: string;
          notificationsEnabled: boolean;
        };

      checks.settingsDefaultsCorrect =
        initialValues.signature === '' &&
        initialValues.displayName === 'S' &&
        initialValues.notificationsEnabled === true;

      const newSettings = {
        signature: 'Regards, SMAIL',
        displayName: 'SMAIL Owner',
        notificationsEnabled: false
      };

      const updateSettings =
        await settingsRequest('PUT', newSettings);

      checks.settingsUpdateSuccessful =
        updateSettings.status === 200;

      const updatedValues =
        await updateSettings.json();

      checks.settingsUpdateResponseCorrect =
        JSON.stringify(updatedValues) ===
        JSON.stringify(newSettings);

      const persisted =
        await settingsRequest('GET');

      checks.settingsPersisted =
        JSON.stringify(await persisted.json()) ===
        JSON.stringify(newSettings);

      const unauthorizedSettings =
        await settingsRequest(
          'GET', undefined, false
        );

      checks.settingsGetProtected =
        unauthorizedSettings.status === 401;

      const unauthorizedUpdate =
        await settingsRequest(
          'PUT', newSettings, false
        );

      checks.settingsPutProtected =
        unauthorizedUpdate.status === 401;

      const invalidType =
        await settingsRequest('PUT', {
          ...newSettings,
          notificationsEnabled: 'false'
        });

      checks.settingsInvalidTypeRejected =
        invalidType.status === 400;

      const invalidName =
        await settingsRequest('PUT', {
          ...newSettings,
          displayName: '   '
        });

      checks.settingsEmptyNameRejected =
        invalidName.status === 400;

      const oversizedSettings =
        await settingsRequest('PUT', {
          ...newSettings,
          signature: 'x'.repeat(20000)
        });

      checks.settingsOversizedRejected =
        oversizedSettings.status === 413;

      const invalidKey =
        await settingsRequest('PUT', {
          ...newSettings,
          ownerEmail: 'other@example.test'
        });

      checks.settingsUnknownKeyRejected =
        invalidKey.status === 400;

      const afterInvalid =
        await settingsRequest('GET');

      checks.settingsInvalidUpdatesPreserveData =
        JSON.stringify(await afterInvalid.json()) ===
        JSON.stringify(newSettings);

      await post('/auth/logout', {
        refreshToken: settingsTokens.refreshToken
      });

      const revokedSettings =
        await settingsRequest('GET');

      checks.settingsRevokedSessionRejected =
        revokedSettings.status === 401;


      const invalidLoginCases = [
        ['legacyPasswordRejected', {
          password: ownerKey,
          deviceLabel: 'Legacy login'
        }],
        ['missingOwnerKeyRejected', {
          deviceLabel: 'Missing key'
        }],
        ['shortOwnerKeyRejected', {
          ownerKey: 'ab',
          deviceLabel: 'Short key'
        }],
        ['oversizedOwnerKeyRejected', {
          ownerKey: 'ab'.repeat(33),
          deviceLabel: 'Long key'
        }],
        ['uppercaseOwnerKeyRejected', {
          ownerKey: 'AB'.repeat(32),
          deviceLabel: 'Uppercase key'
        }],
        ['nonHexOwnerKeyRejected', {
          ownerKey: 'zz'.repeat(32),
          deviceLabel: 'Nonhex key'
        }],
        ['numericOwnerKeyRejected', {
          ownerKey: 123456,
          deviceLabel: 'Numeric key'
        }],
        ['extraLoginFieldRejected', {
          ownerKey,
          deviceLabel: 'Extra field',
          extra: true
        }],
        ['mixedCredentialsRejected', {
          ownerKey,
          password: ownerKey,
          deviceLabel: 'Mixed credentials'
        }],
        ['nullDeviceLabelRejected', {
          ownerKey,
          deviceLabel: 'Invalid\u0000device'
        }],
        ['newlineDeviceLabelRejected', {
          ownerKey,
          deviceLabel: 'Invalid\ndevice'
        }],
        ['emptyDeviceLabelRejected', {
          ownerKey,
          deviceLabel: '   '
        }],
        ['oversizedDeviceLabelRejected', {
          ownerKey,
          deviceLabel: 'x'.repeat(129)
        }]
      ] as const;

      for (const [name, body] of invalidLoginCases) {
        const result = await post(
          '/auth/login',
          body,
          '192.0.2.130'
        );

        checks[name] = result.status === 400;
      }

      async function invalidVerifierRequest(
        verifier: string
      ) {
        return app.request(
          'https://smail.test/auth/login',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'CF-Connecting-IP': '192.0.2.140'
            },
            body: JSON.stringify({
              ownerKey,
              deviceLabel: 'Verifier test'
            })
          },
          {
            ...testEnv,
            OWNER_KEY_HASH: verifier
          }
        );
      }

      const missingVerifier =
        await invalidVerifierRequest('');

      checks.missingVerifierFailsClosed =
        missingVerifier.status === 500;

      const malformedVerifier =
        await invalidVerifierRequest('invalid');

      checks.malformedVerifierFailsClosed =
        malformedVerifier.status === 500;

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
