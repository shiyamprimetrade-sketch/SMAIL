import { randomToken } from './crypto';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const ACCESS_TOKEN_TTL = 900;
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

const ISSUER = 'smail';
const AUDIENCE = 'smail-api';

export interface AccessClaims {
  sub: 'owner';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  sid: string;
  type: 'access';
}

function encode64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decode64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid base64url');
  }

  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  const bytes = Uint8Array.from(
    atob(padded),
    char => char.charCodeAt(0)
  );

  if (encode64(bytes) !== value) {
    throw new Error('Noncanonical base64url');
  }

  return bytes;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error('Invalid JWT signing secret');
  }

  const bytes = Uint8Array.from(
    secret.match(/.{2}/g)!,
    value => parseInt(value, 16)
  );

  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function issueAccessToken(
  secret: string,
  sessionId: string,
  now = Math.floor(Date.now() / 1000)
): Promise<string> {
  if (!sessionId || sessionId.length > 128) {
    throw new Error('Invalid session identifier');
  }

  const header = encode64(
    encoder.encode(JSON.stringify({
      alg: 'HS256',
      typ: 'JWT'
    }))
  );

  const claims: AccessClaims = {
    sub: 'owner',
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
    jti: randomToken(16),
    sid: sessionId,
    type: 'access'
  };

  const payload = encode64(
    encoder.encode(JSON.stringify(claims))
  );

  const input = `${header}.${payload}`;

  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(input)
  );

  return `${input}.${encode64(new Uint8Array(signature))}`;
}

export async function verifyAccessToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000)
): Promise<AccessClaims | null> {
  try {
    if (token.length > 4096) return null;

    const parts = token.split('.');

    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;

    const metadata = JSON.parse(
      decoder.decode(decode64(header))
    );

    if (
      metadata.alg !== 'HS256' ||
      metadata.typ !== 'JWT' ||
      Object.keys(metadata).length !== 2
    ) {
      return null;
    }

    const signatureBytes = decode64(signature);

    if (signatureBytes.length !== 32) return null;

    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      signatureBytes,
      encoder.encode(`${header}.${payload}`)
    );

    if (!valid) return null;

    const claims = JSON.parse(
      decoder.decode(decode64(payload))
    );

    if (
      claims.sub !== 'owner' ||
      claims.iss !== ISSUER ||
      claims.aud !== AUDIENCE ||
      claims.type !== 'access' ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.iat > now ||
      claims.exp <= now ||
      claims.exp - claims.iat !== ACCESS_TOKEN_TTL ||
      typeof claims.jti !== 'string' ||
      !/^[a-f0-9]{32}$/.test(claims.jti) ||
      typeof claims.sid !== 'string' ||
      !claims.sid ||
      claims.sid.length > 128
    ) {
      return null;
    }

    return claims as AccessClaims;

  } catch {
    return null;
  }
}
