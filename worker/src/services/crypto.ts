const encoder = new TextEncoder();

export const PASSWORD_ITERATIONS = 210_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error('Invalid hexadecimal value');
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(
      value.slice(i * 2, i * 2 + 2), 16
    );
  }

  return bytes;
}

export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new Error('Invalid token size');
  }

  return toHex(
    crypto.getRandomValues(new Uint8Array(bytes))
  );
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(value)
  );

  return toHex(new Uint8Array(digest));
}

function constantTimeEqual(
  a: Uint8Array,
  b: Uint8Array
): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    },
    key,
    256
  );

  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string
): Promise<string> {
  if (
    password.length < 12 ||
    encoder.encode(password).length > 1024
  ) {
    throw new Error('Invalid password length');
  }

  const salt = crypto.getRandomValues(
    new Uint8Array(16)
  );

  const hash = await derivePassword(
    password,
    salt,
    PASSWORD_ITERATIONS
  );

  return [
    'pbkdf2-sha256',
    PASSWORD_ITERATIONS,
    toHex(salt),
    toHex(hash)
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  if (encoder.encode(password).length > 1024) {
    return false;
  }

  try {
    const parts = stored.split('$');

    if (parts.length !== 4) return false;

    const [algorithm, rounds, saltHex, hashHex] = parts;

    if (algorithm !== 'pbkdf2-sha256') return false;

    if (!/^[0-9]+$/.test(rounds)) return false;

    const iterations = Number(rounds);

    if (
      !Number.isSafeInteger(iterations) ||
      iterations < PASSWORD_ITERATIONS ||
      iterations > 600_000
    ) {
      return false;
    }

    if (saltHex.length !== 32 || hashHex.length !== 64) {
      return false;
    }

    const salt = fromHex(saltHex);
    const expected = fromHex(hashHex);

    const actual = await derivePassword(
      password,
      salt,
      iterations
    );

    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}
