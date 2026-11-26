# SMAIL Credential Recovery and Replacement

## Credential architecture

SMAIL uses a randomly generated 256-bit owner key.

The raw owner key remains in the owner's private storage.
Cloudflare stores the SHA-256 verifier as OWNER_KEY_HASH.

JWT_SECRET is an independently generated 256-bit secret.

The private local credential file is:

~/.smail-private/credentials.json

Directory permissions: 700
File permissions: 600

Never commit credentials to GitHub.
Never include credentials in screenshots or logs.

## Verified backup recovery

The encrypted backup was successfully decrypted.
Its recovered credentials matched the active local
credentials exactly.

Owner key format, SHA-256 verifier, JWT secret format,
owner email and archive checksum were verified.

## Emergency credential replacement procedure

This procedure requires explicit owner authorization.

1. Establish a trusted deployment environment.
2. Revoke and replace any compromised deployment token.
3. Deploy temporary maintenance protection that blocks
   login, refresh and authenticated private requests.
4. Verify maintenance protection and allow existing
   in-flight authentication requests to finish.
5. Generate a new random 256-bit owner key.
6. Generate an independent new 256-bit JWT secret.
7. Calculate the new owner key SHA-256 verifier.
8. Securely update the local private credential file.
9. Update the corresponding GitHub repository secrets.
10. Revoke every existing refresh token in production D1:

    UPDATE refresh_tokens SET revoked = 1;

11. Deploy the new authentication secrets together.
12. Remove maintenance protection through a controlled
    deployment.
13. Verify that the old owner key is rejected.
14. Verify that old access and refresh tokens are rejected.
15. Verify successful authentication using the new key.
16. Verify production health and session management.
17. Create and verify a new encrypted backup.

Do not execute this procedure without authorization.

Status: documented, not executed or validated end to end.

## Known limitations

The previously exposed Cloudflare deployment token
remains unchanged at the owner's direction.

Credential recovery does not prove full disaster recovery.

Remote-only secrets and live D1 contents are not included
in the local repository and credential backup.

Keep a second encrypted backup outside the phone.
