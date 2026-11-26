import {
  hashPassword,
  verifyPassword
} from '../../src/services/crypto';

export default {
  async fetch(): Promise<Response> {
    const start = Date.now();

    try {
      const password = 'synthetic-runtime-test-2026';
      const hash = await hashPassword(password);
      const valid = await verifyPassword(password, hash);
      const invalid = await verifyPassword('incorrect', hash);

      return Response.json({
        ok: valid && !invalid,
        iterations: 210000,
        passwordVerified: valid,
        incorrectPasswordRejected: !invalid,
        elapsedMs: Date.now() - start
      }, {
        status: valid && !invalid ? 200 : 500
      });
    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error)
      }, { status: 500 });
    }
  }
};
