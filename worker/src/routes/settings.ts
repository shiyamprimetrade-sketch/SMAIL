import { Hono } from 'hono';
import type { AppEnv } from '../env';

interface Settings {
  signature: string;
  displayName: string;
  notificationsEnabled: boolean;
}

export const settings = new Hono<AppEnv>();

async function loadSettings(
  db: D1Database
): Promise<Settings> {

  const result = await db.prepare(`
    SELECT key, value
    FROM settings
    WHERE key IN (
      'signature',
      'display_name',
      'notifications_enabled'
    )
  `).all<{
    key: string;
    value: string;
  }>();

  const values = Object.fromEntries(
    result.results.map(
      row => [row.key, row.value]
    )
  );

  return {
    signature: values.signature ?? '',
    displayName: values.display_name ?? 'S',
    notificationsEnabled:
      values.notifications_enabled !== 'false'
  };
}

settings.get('/', async c => {
  return c.json(
    await loadSettings(c.env.DB)
  );
});

settings.put('/', async c => {

  const maxSize = 16384;
  const request = c.req.raw;

  const tooLarge = () => c.json({
    error: 'payload_too_large',
    message: 'Request too large'
  }, 413);

  const invalid = () => c.json({
    error: 'invalid_request',
    message: 'Invalid settings'
  }, 400);

  const declared = request.headers.get(
    'Content-Length'
  );

  if (
    declared !== null &&
    Number(declared) > maxSize
  ) {
    return tooLarge();
  }

  if (!request.body) {
    return invalid();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let body: unknown;

  try {

    while (true) {

      const { done, value } =
        await reader.read();

      if (done) break;

      total += value.byteLength;

      if (total > maxSize) {

        await reader.cancel().catch(() => {});

        return tooLarge();
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(total);

    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const decoded = new TextDecoder(
      'utf-8'
    ).decode(bytes);

    const encoded = new TextEncoder()
      .encode(decoded);

    if (
      encoded.length !== bytes.length ||
      encoded.some(
        (byte, index) => byte !== bytes[index]
      )
    ) {
      return invalid();
    }

    body = JSON.parse(decoded);

  } catch {
    return invalid();
  } finally {
    reader.releaseLock();
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body)
  ) {
    return invalid();
  }

  const value = body as Record<string, unknown>;

  const allowed = [
    'signature',
    'displayName',
    'notificationsEnabled'
  ];

  if (
    Object.keys(value).length !== 3 ||
    Object.keys(value).some(
      key => !allowed.includes(key)
    ) ||
    typeof value.signature !== 'string' ||
    value.signature.length > 2000 ||
    value.signature.includes('\u0000') ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    value.displayName.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(
      value.displayName
    ) ||
    typeof value.notificationsEnabled !== 'boolean'
  ) {
    return invalid();
  }

  const updated: Settings = {
    signature: value.signature,
    displayName: value.displayName.trim(),
    notificationsEnabled:
      value.notificationsEnabled
  };

  const entries = [
    ['signature', updated.signature],
    ['display_name', updated.displayName],
    [
      'notifications_enabled',
      String(updated.notificationsEnabled)
    ]
  ];

  await c.env.DB.batch(
    entries.map(([key, setting]) =>
      c.env.DB.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE
        SET value = excluded.value
      `).bind(key, setting)
    )
  );

  return c.json(updated);
});
