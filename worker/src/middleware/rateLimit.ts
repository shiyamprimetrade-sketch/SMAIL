export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW = 900;

export type LoginReservation =
  | {
      allowed: true;
      attemptId: string;
    }
  | {
      allowed: false;
      retryAfter: number;
    };

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function reserveLoginAttempt(
  db: D1Database,
  ip: string,
  now = nowSeconds()
): Promise<LoginReservation> {

  const attemptId = crypto.randomUUID();

  const results = await db.batch([
    db.prepare(`
      DELETE FROM login_attempts
      WHERE ip = ? AND at <= ?
    `).bind(ip, now - LOGIN_WINDOW),

    db.prepare(`
      DELETE FROM login_blocks
      WHERE ip = ? AND blocked_until <= ?
    `).bind(ip, now),

    db.prepare(`
      INSERT INTO login_attempts
        (ip, at, attempt_id)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM login_blocks
        WHERE ip = ? AND blocked_until > ?
      )
      AND (
        SELECT COUNT(*) FROM login_attempts
        WHERE ip = ? AND at > ?
      ) < ?
    `).bind(
      ip, now, attemptId,
      ip, now,
      ip, now - LOGIN_WINDOW,
      LOGIN_LIMIT
    )
  ]);

  if (results[2].meta.changes === 1) {
    return {
      allowed: true,
      attemptId
    };
  }

  const block = await db.prepare(`
    SELECT blocked_until
    FROM login_blocks
    WHERE ip = ?
  `).bind(ip).first<{
    blocked_until: number
  }>();

  return {
    allowed: false,
    retryAfter: block
      ? Math.max(1, block.blocked_until - now)
      : LOGIN_WINDOW
  };
}

export async function recordLoginFailure(
  db: D1Database,
  ip: string,
  attemptId: string,
  now = nowSeconds()
): Promise<void> {

  await db.batch([
    db.prepare(`
      UPDATE login_attempts
      SET at = ?
      WHERE ip = ? AND attempt_id = ?
    `).bind(now, ip, attemptId),

    db.prepare(`
      INSERT INTO login_blocks
        (ip, blocked_until)
      SELECT ?, ?
      WHERE (
        SELECT COUNT(*)
        FROM login_attempts
        WHERE ip = ? AND at > ?
      ) >= ?
      ON CONFLICT(ip) DO UPDATE SET
        blocked_until = MAX(
          blocked_until,
          excluded.blocked_until
        )
    `).bind(
      ip,
      now + LOGIN_WINDOW,
      ip,
      now - LOGIN_WINDOW,
      LOGIN_LIMIT
    )
  ]);
}

export async function recordLoginSuccess(
  db: D1Database,
  ip: string,
  attemptId: string
): Promise<void> {

  await db.prepare(`
    DELETE FROM login_attempts
    WHERE ip = ? AND attempt_id = ?
  `).bind(ip, attemptId).run();
}
