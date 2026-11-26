import { timingSafeEqual } from 'node:crypto';

export const OWNER_KEY_BYTES = 32;
export const OWNER_KEY_LENGTH = 64;

const KEY_PATTERN = /^[0-9a-f]{64}$/;

function toHex(bytes: Uint8Array): string {
  return Array.from(
    bytes,
    value => value.toString(16).padStart(2, '0')
  ).join('');
}

function fromHex(value: string): Uint8Array {
  if (!KEY_PATTERN.test(value)) {
    throw new Error('Invalid hexadecimal digest');
  }

  const result = new Uint8Array(OWNER_KEY_BYTES);

  for (let i = 0; i < result.length; i++) {
    result[i] = Number.parseInt(
      value.slice(i * 2, i * 2 + 2),
      16
    );
  }

  return result;
}

export function isOwnerKey(
  value: unknown
): value is string {
  return (
    typeof value === 'string' &&
    value.length === OWNER_KEY_LENGTH &&
    KEY_PATTERN.test(value)
  );
}

export function generateOwnerKey(): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(OWNER_KEY_BYTES)
  );

  return toHex(bytes);
}

export async function hashOwnerKey(
  ownerKey: string
): Promise<string> {
  if (!isOwnerKey(ownerKey)) {
    throw new Error('Invalid owner key format');
  }

  const bytes = new TextEncoder().encode(ownerKey);

  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes
  );

  return toHex(new Uint8Array(digest));
}

export async function verifyOwnerKey(
  ownerKey: unknown,
  storedHash: unknown
): Promise<boolean> {
  if (
    !isOwnerKey(ownerKey) ||
    !isOwnerKey(storedHash)
  ) {
    return false;
  }

  const calculatedHash = await hashOwnerKey(ownerKey);

  return timingSafeEqual(
    fromHex(calculatedHash),
    fromHex(storedHash)
  );
}
