
import { pbkdf2 } from 'node:crypto';

const expected = '66f284793bc6724cfb1cd3ed4ba709dcdd8af422e16c20fa26403de6f95fc426';

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path !== '/correct' && path !== '/incorrect') {
      return new Response('Not found', { status: 404 });
    }

    const correct = path === '/correct';
    const password = correct
      ? 'SMAIL-synthetic-node-kdf'
      : 'incorrect-password';

    const salt = Uint8Array.from(
      { length: 16 }, (_, i) => i
    );

    const start = Date.now();

    try {
      const result = await new Promise<string>(
        (resolve, reject) => {
          pbkdf2(
            password, salt, 210000, 32, 'sha256',
            (error, key) => {
              if (error) reject(error);
              else resolve(key.toString('hex'));
            }
          );
        }
      );

      const verified = result === expected;
      const ok = verified === correct;

      return Response.json({
        ok,
        verified,
        iterations: 210000,
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
