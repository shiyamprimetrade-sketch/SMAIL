# ADR-001: SMAIL Owner Key Authentication

Status: Authorized
Checkpoint: M02.08.18
Date: 2026-11-26

## Context

SMAIL is a private single-user email application.

Hosted Cloudflare WebCrypto and Node.js PBKDF2
reject iteration counts above 100000.

The original specification requires PBKDF2 with
at least 210000 iterations or Argon2.

Argon2id mathematical validation succeeded.
Dynamic WebAssembly compilation failed inside
the Cloudflare runtime.

## Decision

Founder authorized Option A:
256-bit randomly generated owner key authentication.

## Security requirements

- Generate 32 random bytes using a CSPRNG.
- Encode as 64 lowercase hexadecimal characters.
- Reject malformed owner keys.
- Store only the SHA-256 verifier server-side.
- Store the verifier as OWNER_KEY_HASH.
- Use timing-safe digest comparison.
- Require HTTPS.
- Never log owner keys.
- Never commit actual credentials.
- Preserve login rate limiting.
- Preserve JWT expiration.
- Preserve refresh token rotation.
- Preserve session replay protection.
- Support secure owner key replacement.
- Revoke existing sessions during key replacement.

## Compatibility

The login API will migrate from password
authentication to ownerKey authentication.

The existing password implementation remains
temporarily available in source for regression
testing until the migration is completed.

## Acceptance criteria

- Cryptographic unit tests pass.
- Hosted Cloudflare verification passes.
- Authentication regression tests pass.
- Production secrets are configured securely.
- Original production health remains available.
- No additional paid infrastructure is required.

## Limitations

This architecture is intended for a private
single-user application.

Human-chosen passwords must not be substituted
for randomly generated 256-bit owner keys.

A stolen owner key can authenticate until revoked.

Production activation requires secure secret
configuration and credential rotation.
