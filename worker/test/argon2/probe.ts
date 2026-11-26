import { argon2Verify } from 'hash-wasm';

const reference =
  '$argon2id$v=19$m=19456,t=2,p=1$' +
  'KioqKioqKioqKioqKioqKg$' +
  'g2AvZAG00H6APDIP7D7ZWvvl1rDG8lCwKPhlKBaa5Ng';

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path !== '/correct' && path !== '/incorrect') {
      return new Response('Not found', { status: 404 });
    }

    const expected = path === '/correct';

    const password = expected
      ? 'synthetic-argon2-test-2026'
      : 'incorrect-password';

    const start = Date.now();

    try {
      const verified = await argon2Verify({
        password,
        hash: reference
      });

      const ok = verified === expected;

      return Response.json({
        ok,
        algorithm: 'argon2id',
        memoryKiB: 19456,
        iterations: 2,
        verified,
        expected,
        elapsedMs: Date.now() - start
      }, { status: ok ? 200 : 500 });

    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error),
        elapsedMs: Date.now() - start
      }, { status: 500 });
    }
  }
};
