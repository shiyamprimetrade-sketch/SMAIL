# SMAIL
Private single-user Android email client for contact@slickk.online. Target: zero additional cost, no payment card, CI-only builds. The source repository is public. Mailbox data and credentials must remain private.

## Milestone 1
Cloudflare Worker `smail`, TypeScript/Hono, HTTPS health endpoint and GitHub Actions. No mail handling, authentication or database access yet.

## Deployment
Configure Cloudflare API token and account ID as GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Confirm the API hostname is unused (see docs/DNS.md). Push to main. CI installs dependencies, checks types, runs tests, deploys and verifies HTTPS. Download the `worker-lockfile` artifact and commit its package-lock.json for subsequent reproducible installs.

## Roadmap
1. Foundation
2. Auth and schema
3. Inbound and threading
4. Outbound and webhooks
5. Flutter scaffold and signing
6. Core mobile client
7. Push, lock and scheduled cleanup

See [API](docs/API.md) and [DNS](docs/DNS.md). Never commit secrets. Do not enable email routing to this Worker until inbound handling is verified.
