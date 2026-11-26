import {
  normalizeParticipant,
} from './threadIdentity';

import {
  truncateUtf8,
} from './mime';

export const MAX_CONTACT_NAME_BYTES = 512;

export interface ContactRecord {
  email: string;
  name: string | null;
  last_used: number;
}

export function prepareContactRecord(
  email: string,
  name: string | null,
  now: number,
): ContactRecord | null {
  if (
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    throw new Error(
      'Invalid contact timestamp'
    );
  }

  const address =
    normalizeParticipant(email);

  if (
    !address ||
    address.length > 320 ||
    !/^[^@\s]+@[^@\s]+$/u.test(address) ||
    /[\u0000-\u001f\u007f]/.test(address)
  ) {
    return null;
  }

  const cleanName = truncateUtf8(
    (name ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
    MAX_CONTACT_NAME_BYTES,
  );

  return {
    email: address,
    name: cleanName || null,
    last_used: now,
  };
}

export function buildContactStatement(
  db: D1Database,
  email: string,
  name: string | null,
  now: number,
): D1PreparedStatement | null {
  const contact = prepareContactRecord(
    email,
    name,
    now,
  );

  if (!contact) {
    return null;
  }

  return db.prepare(`
    INSERT INTO contacts (
      email,
      name,
      last_used,
      use_count
    )
    VALUES (?, ?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET
      name = CASE
        WHEN excluded.last_used >= contacts.last_used
          AND excluded.name IS NOT NULL
        THEN excluded.name
        ELSE contacts.name
      END,
      last_used = MAX(
        contacts.last_used,
        excluded.last_used
      ),
      use_count = contacts.use_count + 1
  `).bind(
    contact.email,
    contact.name,
    contact.last_used,
  );
}
