
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
      !['/correct', '/incorrect'].includes(path)
    ) {
      return new Response('Not found', {
        status: 404
      });
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
