# DNS

## Milestone 1
The slickk.online zone must be active in Cloudflare. Confirm api.slickk.online is not serving another application and has no conflicting DNS record or Worker route. Do not delete or replace existing records without reviewing their purpose. Wrangler provisions the custom domain and TLS. Verify HTTPS GET /health. Preserve all unrelated DNS records.

## Planned records (not verified or applied)
- MX at @: Cloudflare Email Routing assigned hosts, after inbound implementation is ready.
- SPF: use provider-issued values at their specified hostnames; only one SPF policy per hostname. Merge mechanisms only when providers require the same hostname. Resend may use a separate return-path subdomain.
- DKIM: exact selector and value issued by Resend.
- DMARC at _dmarc: planned `v=DMARC1; p=none; rua=mailto:contact@slickk.online`; enable reporting only when mailbox is operational.
- API hostname: Cloudflare-managed custom domain, do not manually invent target records.

Do not activate routing for contact@slickk.online until Milestone 3 is verified. Preserve existing mail service until a deliberate cutover.
