
import {
  verifyPassword,
  PASSWORD_ITERATIONS
} from '../../src/services/crypto';

const PASSWORD = 'synthetic-production-test-2026';
const HASH = 'pbkdf2-sha256$210000$0123456789abcdef0123456789abcdef$25b3f372b28ee6a82846fbaf5f938fa27b2b73fceeb377634c24930d6c15e042';

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (
      request.method !== 'GET' ||
      !['/correct', '/incorrect', '/diagnostic'].includes(path)
    ) {
      return new Response('Not found', {
        status: 404
      });
    }


    if (path === '/diagnostic') {
      try {
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode('synthetic-test'),
          'PBKDF2',
          false,
          ['deriveBits']
        );

        await crypto.subtle.deriveBits({
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: new Uint8Array(16),
          iterations: 210000
        }, key, 256);

        return Response.json({
          ok: true,
          iterations: 210000
        });
      } catch (error) {
        return Response.json({
          ok: false,
          iterations: 210000,
          error: String(error)
        }, { status: 500 });
      }
    }

    const start = Date.now();

    const verified = await verifyPassword(
      path === '/correct'
        ? PASSWORD
        : 'incorrect-password',
      HASH
    );

    const ok = path === '/correct'
      ? verified
      : !verified;

    return Response.json({
      ok,
      verified,
      iterations: PASSWORD_ITERATIONS,
      elapsedMs: Date.now() - start
    }, {
      status: ok ? 200 : 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
};
