import {
  normalizeParticipant,
} from './threadIdentity';

export async function isKnownSender(
  db: D1Database,
  sender: string,
): Promise<boolean> {
  const address =
    normalizeParticipant(sender);

  if (
    !address ||
    address.length > 320 ||
    !/^[^@\s]+@[^@\s]+$/u.test(address) ||
    /[\u0000-\u001f\u007f]/.test(address)
  ) {
    return false;
  }

  const result = await db.prepare(`
    SELECT email
    FROM contacts
    WHERE email = ?
    LIMIT 1
  `)
    .bind(address)
    .first<{ email: string }>();

  return result !== null;
}
