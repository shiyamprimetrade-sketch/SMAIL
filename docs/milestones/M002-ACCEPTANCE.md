# SMAIL Milestone 2 Engineering Acceptance

Date: 2026-11-26

## Production baseline

Repository: shiyamprimetrade-sketch/SMAIL

Production commit:
7a1b7a2d53aba940a346cba841bf8927b7d466f8

Production deployment:
45808941717

Production API:
https://api.slickk.online

Owner mailbox:
contact@slickk.online

## Technology stack

- TypeScript
- Hono 4.13.22
- Cloudflare Workers
- Cloudflare D1
- SQLite FTS5
- WebCrypto SHA-256
- HMAC-SHA256 JWT
- Node.js timing-safe comparison
- Wrangler 4.168.0
- Vitest 5.1.2
- Python unittest
- GitHub Actions
- Termux
- GPG AES-256 encrypted backups

## Implemented capabilities

- Database schema and four production migrations
- Random 256-bit owner key authentication
- SHA-256 owner key verification
- JWT access tokens with 900-second lifetime
- Refresh tokens with 30-day lifetime
- Hashed refresh token storage
- Atomic refresh token rotation
- Refresh token replay detection
- Global session revocation
- Logout and session invalidation
- IP-based login rate limiting
- Authentication middleware
- Authenticated settings API
- Device label persistence
- Bounded request parsing
- Dependency security remediation
- Production secret deployment
- Encrypted credential backup and recovery

## Verification evidence

SQLite database tests: 30/30
Worker unit tests: 52/52
Authentication integration tests: 60/60
Session runtime tests: 13/13
Rate-limiting runtime tests: 12/12
Hosted owner key cryptography: 10/10
Live production authentication: 16/16
Live production replay protection: 12/12

Aggregate: 205/205 checks across overlapping suites.

Production health: PASS
Unauthorized settings access: HTTP 401
Actual owner authentication: HTTP 200
Credential recovery: PASS

## Architecture deviation

Hosted Cloudflare WebCrypto rejected PBKDF2 iteration
counts above 100000.

The required 210000 iterations could not execute.

Argon2 was investigated but the tested implementation
encountered runtime WebAssembly restrictions.

The owner explicitly authorized replacement of password
authentication with a random 256-bit owner key.

See docs/architecture/ADR-001-owner-key.md.

## Known limitations

- Previously exposed deployment token remains unchanged.
- Full disaster recovery has not been exercised.
- Credential replacement procedure is documented but untested.
- Production rate-limiting acceptance is based on local
  runtime testing rather than a dedicated live abuse test.
- Node.js action deprecation warnings remain.
- Inbound and outbound email processing are not implemented.
- Android application development has not started.

## Acceptance status

Functional production acceptance: PASS.

Security limitations remain documented.

Final milestone closure requires updated encrypted backup.

No authorization to begin Milestone 3 is implied.
