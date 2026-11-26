import {
  scoreSpam,
  type SpamDecision,
} from './spam';

import {
  interpretAuthentication,
} from './spamAuthentication';

import {
  hasEmptySubjectLinkHeavyBody,
} from './spamContent';

import {
  isKnownSender,
} from './spamContacts';

import {
  allowKnownSenderCredit,
} from './spamTrust';

import type {
  SpamClassificationInput,
} from './spamClassifier';

export interface SecureSpamInput
  extends SpamClassificationInput {
  senderIdentityVerified?: boolean;
}

export async function classifySecureInboundSpam(
  db: D1Database,
  input: SecureSpamInput,
): Promise<SpamDecision> {
  const authentication =
    interpretAuthentication(
      input.authentication ?? {
        trusted: false,
      }
    );

  const identityVerified =
    input.senderIdentityVerified === true &&
    input.authentication?.trusted === true;

  const knownSender = identityVerified
    ? await isKnownSender(db, input.sender)
    : false;

  const contactCredit =
    allowKnownSenderCredit({
      knownSender,
      senderIdentityVerified: identityVerified,
      authentication,
    });

  return scoreSpam({
    ...authentication,
    emptySubjectLinkHeavy:
      hasEmptySubjectLinkHeavyBody(
        input.subject,
        input.text,
      ),
    knownSender: contactCredit,
  });
}
