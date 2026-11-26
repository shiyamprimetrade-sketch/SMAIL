import { randomToken, sha256 } from './crypto';
import {
  issueAccessToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL
} from './jwt';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface SessionRow {
  id: string;
  device_id: string | null;
  expires_at: number;
  revoked: number;
  replaced_by: string | null;
}

export type RotationResult =
  | { status: 'ok'; tokens: TokenPair }
  | { status: 'invalid' }
  | { status: 'replay' };

function currentTime(): number {
  return Math.floor(Date.now() / 1000);
}

function validRefreshToken(token: string): boolean {
  return /^[a-f0-9]{64}$/.test(token);
}

export async function revokeAllSessions(
  db: D1Database
): Promise<void> {
  await db.prepare(
    'UPDATE refresh_tokens SET revoked = 1 WHERE revoked = 0'
  ).run();
}

export async function createSession(
  db: D1Database,
  secret: string,
  deviceLabel: string = 'Unknown device'
): Promise<TokenPair> {
  const label = deviceLabel.trim();

  if (
    label.length === 0 ||
    label.length > 128
  ) {
    throw new Error('Invalid device label');
  }
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const refreshToken = randomToken();
  const tokenHash = await sha256(refreshToken);
  const now = currentTime();

  const accessToken = await issueAccessToken(
    secret,
    sessionId,
    now
  );

  await db.prepare(`
    INSERT INTO refresh_tokens
      (id, token_hash, device_id, expires_at, revoked, device_label)
    VALUES (?, ?, ?, ?, 0, ?)
  `).bind(
    id,
    tokenHash,
    sessionId,
    now + REFRESH_TOKEN_TTL,
    label
  ).run();

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL
  };
}

export async function rotateSession(
  db: D1Database,
  secret: string,
  refreshToken: string
): Promise<RotationResult> {

  if (!validRefreshToken(refreshToken)) {
    return { status: 'invalid' };
  }

  const oldHash = await sha256(refreshToken);
  const now = currentTime();

  const old = await db.prepare(`
    SELECT id, device_id, expires_at, revoked, replaced_by
    FROM refresh_tokens
    WHERE token_hash = ?
  `).bind(oldHash).first<SessionRow>();

  if (!old) {
    return { status: 'invalid' };
  }

  if (old.revoked !== 0) {
    await revokeAllSessions(db);
    return { status: 'replay' };
  }

  if (old.expires_at <= now || !old.device_id) {
    return { status: 'invalid' };
  }

  const nextId = crypto.randomUUID();
  const nextToken = randomToken();
  const nextHash = await sha256(nextToken);

  const accessToken = await issueAccessToken(
    secret,
    old.device_id,
    now
  );

  const results = await db.batch([
    db.prepare(`
      UPDATE refresh_tokens
      SET revoked = 1, replaced_by = ?
      WHERE id = ?
        AND revoked = 0
        AND expires_at > ?
    `).bind(nextId, old.id, now),

    db.prepare(`
      INSERT INTO refresh_tokens
        (id, token_hash, device_id, expires_at, revoked, device_label)
      SELECT ?, ?, device_id, ?, 0, device_label
      FROM refresh_tokens
      WHERE id = ?
        AND revoked = 1
        AND replaced_by = ?
    `).bind(
      nextId,
      nextHash,
      now + REFRESH_TOKEN_TTL,
      old.id,
      nextId
    ),

    db.prepare(`
      UPDATE refresh_tokens
      SET revoked = 1
      WHERE revoked = 0
        AND EXISTS (
          SELECT 1 FROM refresh_tokens
          WHERE id = ?
            AND revoked = 1
            AND (
              replaced_by IS NULL
              OR replaced_by <> ?
            )
        )
    `).bind(old.id, nextId)
  ]);

  if (
    results[0].meta.changes !== 1 ||
    results[1].meta.changes !== 1
  ) {
    return { status: 'replay' };
  }

  return {
    status: 'ok',
    tokens: {
      accessToken,
      refreshToken: nextToken,
      expiresIn: ACCESS_TOKEN_TTL
    }
  };
}

export async function revokeSession(
  db: D1Database,
  refreshToken: string
): Promise<void> {

  if (!validRefreshToken(refreshToken)) {
    return;
  }

  const hash = await sha256(refreshToken);

  await db.prepare(`
    UPDATE refresh_tokens
    SET revoked = 1
    WHERE revoked = 0
      AND device_id IN (
        SELECT device_id
        FROM refresh_tokens
        WHERE token_hash = ?
      )
  `).bind(hash).run();
}

export async function isSessionActive(
  db: D1Database,
  sessionId: string
): Promise<boolean> {

  const result = await db.prepare(`
    SELECT id
    FROM refresh_tokens
    WHERE device_id = ?
      AND revoked = 0
      AND expires_at > ?
    LIMIT 1
  `).bind(
    sessionId,
    currentTime()
  ).first<{ id: string }>();

  return result !== null;
}
