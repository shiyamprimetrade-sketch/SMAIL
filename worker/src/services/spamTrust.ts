import type {
  AuthenticationSignals,
} from './spamAuthentication';

export interface ContactTrustInput {
  knownSender: boolean;
  senderIdentityVerified: boolean;
  authentication: AuthenticationSignals;
}

export function allowKnownSenderCredit(
  input: ContactTrustInput,
): boolean {
  return (
    input.knownSender === true &&
    input.senderIdentityVerified === true &&
    input.authentication.spfFailed === false &&
    input.authentication.dkimFailed === false &&
    input.authentication.cloudflareSpam === false
  );
}
