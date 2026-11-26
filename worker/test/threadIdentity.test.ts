import { describe, expect, it } from 'vitest';

import {
  THREAD_WINDOW_MS,
  normalizeSubject,
  normalizeMessageId,
  referenceCandidates,
  normalizeParticipant,
  withinThreadWindow,
} from '../src/services/threadIdentity';

describe('Subject normalization', () => {
  it.each([
    ['Invoice', 'invoice'],
    ['RE: Invoice', 'invoice'],
    ['FWD: Invoice', 'invoice'],
    ['FW: Invoice', 'invoice'],
    ['Re: Fwd: RE: Invoice', 'invoice'],
    ['  Re:   Invoice  ', 'invoice'],
    ['RE : Invoice', 'invoice'],
    ['Monthly   Invoice', 'monthly invoice'],
    ['বাংলাদেশ', 'বাংলাদেশ'],
    ['', ''],
    ['Re: Fwd:', ''],
    ['Report: Invoice', 'report: invoice'],
    ['Invoice RE: 2026', 'invoice re: 2026'],
    ['Re:'.repeat(1000) + 'Invoice', 'invoice'],
  ])('normalizes subject %#', (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });
});

describe('Message identity', () => {
  it.each([
    ['<abc@example.com>', '<abc@example.com>'],
    ['  <abc@example.com>  ', '<abc@example.com>'],
    ['<ABC@example.com>', '<ABC@example.com>'],
    [null, null],
    ['', null],
    ['abc@example.com', null],
    ['<a b@example.com>', null],
    ['<a><b>', null],
    ['<a\nb>', null],
    ['<' + 'a'.repeat(999) + '>', null],
  ])('validates message identity %#', (input, expected) => {
    expect(normalizeMessageId(input)).toBe(expected);
  });

  it('prioritizes recent references', () => {
    expect(referenceCandidates([
      '<root@example.com>',
      '<parent@example.com>',
    ])).toEqual([
      '<parent@example.com>',
      '<root@example.com>',
    ]);
  });

  it('removes duplicate references', () => {
    expect(referenceCandidates([
      '<a@example.com>',
      '<b@example.com>',
      '<a@example.com>',
    ])).toEqual([
      '<a@example.com>',
      '<b@example.com>',
    ]);
  });

  it('ignores malformed references', () => {
    expect(referenceCandidates([
      'invalid',
      '<valid@example.com>',
      '',
    ])).toEqual([
      '<valid@example.com>',
    ]);
  });

  it('handles empty references', () => {
    expect(referenceCandidates([])).toEqual([]);
  });
});

describe('Participant identity', () => {
  it.each([
    [' sender@example.com ', 'sender@example.com'],
    ['Sender@EXAMPLE.COM', 'Sender@example.com'],
    ['sender+invoice@example.com', 'sender+invoice@example.com'],
    ['', ''],
  ])('normalizes participant %#', (input, expected) => {
    expect(normalizeParticipant(input)).toBe(expected);
  });
});

describe('Conversation time window', () => {
  const now = 1800000000000;

  it('accepts current timestamp', () => {
    expect(withinThreadWindow(now, now)).toBe(true);
  });

  it('accepts exact 30-day boundary', () => {
    expect(withinThreadWindow(
      now - THREAD_WINDOW_MS,
      now,
    )).toBe(true);
  });

  it('rejects expired conversations', () => {
    expect(withinThreadWindow(
      now - THREAD_WINDOW_MS - 1,
      now,
    )).toBe(false);
  });

  it('rejects future timestamps', () => {
    expect(withinThreadWindow(
      now + 1,
      now,
    )).toBe(false);
  });

  it('rejects invalid timestamps', () => {
    expect(withinThreadWindow(NaN, now)).toBe(false);
  });

  it('rejects negative timestamps', () => {
    expect(withinThreadWindow(-1, now)).toBe(false);
  });

  it('rejects fractional timestamps', () => {
    expect(withinThreadWindow(
      now - 0.5,
      now,
    )).toBe(false);
  });
});
