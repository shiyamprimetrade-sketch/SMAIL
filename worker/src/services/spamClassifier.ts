import {
  scoreSpam,
  type SpamDecision,
} from './spam';

import {
  interpretAuthentication,
  type AuthenticationInput,
} from './spamAuthentication';

import {
  hasEmptySubjectLinkHeavyBody,
} from './spamContent';

import {
  isKnownSender,
} from './spamContacts';

export interface SpamClassificationInput {
  sender: string;
  subject: string;
  text: string;
  authentication?: AuthenticationInput;
}

export async function classifyInboundSpam(
  db: D1Database,
  input: SpamClassificationInput,
): Promise<SpamDecision> {
  const authentication =
    interpretAuthentication(
      input.authentication ?? {
        trusted: false,
      }
    );

  const emptySubjectLinkHeavy =
    hasEmptySubjectLinkHeavyBody(
      input.subject,
      input.text,
    );

  const knownSender =
    await isKnownSender(
      db,
      input.sender,
    );

  return scoreSpam({
    ...authentication,
    emptySubjectLinkHeavy,
    knownSender,
  });
}
