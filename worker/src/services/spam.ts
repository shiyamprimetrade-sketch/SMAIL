export const SPAM_THRESHOLD = 5;

export const SPAM_WEIGHTS = Object.freeze({
  spfFailed: 2,
  dkimFailed: 2,
  cloudflareSpam: 3,
  emptySubjectLinkHeavy: 2,
  knownSender: -3,
});

export interface SpamSignals {
  spfFailed: boolean;
  dkimFailed: boolean;
  cloudflareSpam: boolean;
  emptySubjectLinkHeavy: boolean;
  knownSender: boolean;
}

export interface SpamEvidence {
  signal: keyof SpamSignals;
  points: number;
}

export interface SpamDecision {
  score: number;
  folder: 'inbox' | 'spam';
  evidence: SpamEvidence[];
}

export function scoreSpam(
  signals: Readonly<SpamSignals>,
): SpamDecision {
  let score = 0;

  const evidence: SpamEvidence[] = [];

  const keys = Object.keys(
    SPAM_WEIGHTS
  ) as (keyof SpamSignals)[];

  for (const signal of keys) {
    if (signals[signal] !== true) {
      continue;
    }

    const points = SPAM_WEIGHTS[signal];

    score += points;

    evidence.push({
      signal,
      points,
    });
  }

  return {
    score,
    folder:
      score >= SPAM_THRESHOLD
        ? 'spam'
        : 'inbox',
    evidence,
  };
}
