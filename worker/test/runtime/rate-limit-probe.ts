import {
  reserveLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess
} from '../../src/middleware/rateLimit';

interface Env {
  DB: D1Database;
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const db = env.DB;
    const checks: Record<string, boolean> = {};
    const now = 1800000000;

    try {
      await db.batch([
        db.prepare('DELETE FROM login_attempts'),
        db.prepare('DELETE FROM login_blocks')
      ]);

      const ip = '192.0.2.10';

      let accepted = 0;

      for (let i = 0; i < 5; i++) {
        const result = await reserveLoginAttempt(
          db, ip, now
        );

        if (result.allowed) {
          accepted++;

          await recordLoginFailure(
            db, ip, result.attemptId, now
          );
        }
      }

      checks.firstFiveAccepted = accepted === 5;

      const sixth = await reserveLoginAttempt(
        db, ip, now
      );

      checks.sixthBlocked = !sixth.allowed;

      checks.blockDuration =
        !sixth.allowed &&
        sixth.retryAfter === 900;

      const other = await reserveLoginAttempt(
        db, '192.0.2.20', now
      );

      checks.ipIsolation = other.allowed;

      const early = await reserveLoginAttempt(
        db, ip, now + 899
      );

      checks.blockStillActive = !early.allowed;

      const expired = await reserveLoginAttempt(
        db, ip, now + 900
      );

      checks.blockExpired = expired.allowed;

      const successIp = '192.0.2.30';

      let successful = 0;

      for (let i = 0; i < 10; i++) {

        const result = await reserveLoginAttempt(
          db, successIp, now
        );

        if (result.allowed) {
          successful++;

          await recordLoginSuccess(
            db, successIp, result.attemptId
          );
        }
      }

      checks.successfulAttemptsRemoved =
        successful === 10;

      const concurrentIp = '192.0.2.40';

      const concurrent = await Promise.all(
        Array.from({ length: 20 }, () =>
          reserveLoginAttempt(
            db, concurrentIp, now
          )
        )
      );

      checks.concurrentLimit =
        concurrent.filter(
          result => result.allowed
        ).length === 5;

      checks.concurrentRejections =
        concurrent.filter(
          result => !result.allowed
        ).length === 15;

      const stored = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM login_attempts
        WHERE ip = ?
      `).bind(concurrentIp).first<{
        count: number
      }>();

      checks.databaseLimit =
        stored?.count === 5;

      const rollingIp = '192.0.2.50';

      const old = await reserveLoginAttempt(
        db, rollingIp, now
      );

      if (old.allowed) {
        await recordLoginFailure(
          db, rollingIp, old.attemptId, now
        );
      }

      await reserveLoginAttempt(
        db, rollingIp, now + 901
      );

      const remaining = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM login_attempts
        WHERE ip = ?
      `).bind(rollingIp).first<{
        count: number
      }>();

      checks.expiredAttemptsRemoved =
        remaining?.count === 1;


      const mixedIp = '192.0.2.60';

      const mixed = await Promise.all(
        Array.from({ length: 5 }, () =>
          reserveLoginAttempt(db, mixedIp, now)
        )
      );

      const reserved = mixed.filter(
        result => result.allowed
      );

      if (reserved.length !== 5) {
        throw new Error('Mixed reservation failed');
      }

      const first = reserved[0];

      if (!first.allowed) {
        throw new Error('Reservation unavailable');
      }

      await recordLoginFailure(
        db, mixedIp, first.attemptId, now
      );

      for (const result of reserved.slice(1)) {
        if (result.allowed) {
          await recordLoginSuccess(
            db, mixedIp, result.attemptId
          );
        }
      }

      const mixedNext = await reserveLoginAttempt(
        db, mixedIp, now
      );

      checks.mixedAttemptsDoNotCauseFalseBlock =
        mixedNext.allowed;

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
