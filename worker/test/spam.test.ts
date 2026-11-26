import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  scoreSpam,
  SPAM_THRESHOLD,
  SPAM_WEIGHTS,
  type SpamSignals,
} from '../src/services/spam';

function signals(
  overrides: Partial<SpamSignals> = {},
): SpamSignals {
  return {
    spfFailed: false,
    dkimFailed: false,
    cloudflareSpam: false,
    emptySubjectLinkHeavy: false,
    knownSender: false,
    ...overrides,
  };
}

describe('Deterministic spam classification', () => {
  it('uses the specified threshold', () => {
    expect(SPAM_THRESHOLD).toBe(5);
  });

  it('classifies clean messages as inbox', () => {
    expect(scoreSpam(signals())).toEqual({
      score: 0,
      folder: 'inbox',
      evidence: [],
    });
  });

  it('scores SPF failure', () => {
    expect(scoreSpam(signals({
      spfFailed: true,
    })).score).toBe(2);
  });

  it('scores DKIM failure', () => {
    expect(scoreSpam(signals({
      dkimFailed: true,
    })).score).toBe(2);
  });

  it('scores Cloudflare spam flag', () => {
    expect(scoreSpam(signals({
      cloudflareSpam: true,
    })).score).toBe(3);
  });

  it('scores empty subject with links', () => {
    expect(scoreSpam(signals({
      emptySubjectLinkHeavy: true,
    })).score).toBe(2);
  });

  it('reduces score for known senders', () => {
    expect(scoreSpam(signals({
      knownSender: true,
    })).score).toBe(-3);
  });

  it('keeps score four in inbox', () => {
    const result = scoreSpam(signals({
      spfFailed: true,
      dkimFailed: true,
    }));

    expect(result.score).toBe(4);
    expect(result.folder).toBe('inbox');
  });

  it('classifies exact threshold as spam', () => {
    const result = scoreSpam(signals({
      spfFailed: true,
      cloudflareSpam: true,
    }));

    expect(result.score).toBe(5);
    expect(result.folder).toBe('spam');
  });

  it('classifies score above threshold as spam', () => {
    const result = scoreSpam(signals({
      spfFailed: true,
      dkimFailed: true,
      cloudflareSpam: true,
    }));

    expect(result.score).toBe(7);
    expect(result.folder).toBe('spam');
  });

  it('applies known sender reduction', () => {
    const result = scoreSpam(signals({
      spfFailed: true,
      cloudflareSpam: true,
      knownSender: true,
    }));

    expect(result.score).toBe(2);
    expect(result.folder).toBe('inbox');
  });

  it('does not exempt known senders from spam', () => {
    const result = scoreSpam(signals({
      spfFailed: true,
      dkimFailed: true,
      cloudflareSpam: true,
      emptySubjectLinkHeavy: true,
      knownSender: true,
    }));

    expect(result.score).toBe(6);
    expect(result.folder).toBe('spam');
  });

  it('supports the maximum score', () => {
    expect(scoreSpam(signals({
      spfFailed: true,
      dkimFailed: true,
      cloudflareSpam: true,
      emptySubjectLinkHeavy: true,
    })).score).toBe(9);
  });

  it('provides explainable scoring evidence', () => {
    const result = scoreSpam(signals({
      spfFailed: true,
      cloudflareSpam: true,
      knownSender: true,
    }));

    expect(result.evidence).toEqual([
      { signal: 'spfFailed', points: 2 },
      { signal: 'cloudflareSpam', points: 3 },
      { signal: 'knownSender', points: -3 },
    ]);
  });

  it('does not mutate input signals', () => {
    const input = Object.freeze(signals({
      spfFailed: true,
    }));

    expect(scoreSpam(input).score).toBe(2);
    expect(input.spfFailed).toBe(true);
  });

  it('produces deterministic decisions', () => {
    const input = signals({
      spfFailed: true,
      cloudflareSpam: true,
    });

    expect(scoreSpam(input)).toEqual(
      scoreSpam(input)
    );
  });

  it('protects scoring weights from mutation', () => {
    expect(
      Object.isFrozen(SPAM_WEIGHTS)
    ).toBe(true);
  });
});

describe('Exhaustive spam signal combinations', () => {
  const cases = Array.from(
    { length: 32 },
    (_, mask) => mask,
  );

  it.each(cases)(
    'verifies signal combination %i',
    (mask) => {
      const input = signals({
        spfFailed: Boolean(mask & 1),
        dkimFailed: Boolean(mask & 2),
        cloudflareSpam: Boolean(mask & 4),
        emptySubjectLinkHeavy: Boolean(mask & 8),
        knownSender: Boolean(mask & 16),
      });

      const expected =
        (mask & 1 ? 2 : 0) +
        (mask & 2 ? 2 : 0) +
        (mask & 4 ? 3 : 0) +
        (mask & 8 ? 2 : 0) -
        (mask & 16 ? 3 : 0);

      const result = scoreSpam(input);

      expect(result.score).toBe(expected);

      expect(result.folder).toBe(
        expected >= 5 ? 'spam' : 'inbox'
      );

      expect(
        result.evidence.reduce(
          (sum, item) => sum + item.points,
          0,
        )
      ).toBe(expected);
    },
  );
});
