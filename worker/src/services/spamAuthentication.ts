import type { SpamSignals } from './spam';

export const MAX_AUTH_HEADER_BYTES = 16384;
export const MAX_AUTH_HEADERS = 16;

export interface AuthenticationInput {
  trusted: boolean;
  authenticationResults?: readonly string[];
  spamFlags?: readonly string[];
}

export type AuthenticationSignals = Pick<
  SpamSignals,
  'spfFailed' |
  'dkimFailed' |
  'cloudflareSpam'
>;

function removeCommentsAndQuotes(
  value: string,
): string {
  let output = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (
      char === '\\' &&
      (quoted || depth > 0)
    ) {
      escaped = true;
      continue;
    }

    if (depth > 0) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      continue;
    }

    if (quoted) {
      if (char === '"') quoted = false;
      continue;
    }

    if (char === '(') {
      depth++;
      output += ' ';
      continue;
    }

    if (char === '"') {
      quoted = true;
      output += ' ';
      continue;
    }

    output += char;
  }

  if (depth !== 0 || quoted || escaped) {
    return '';
  }

  return output;
}

function safeHeader(
  value: string,
): string {
  if (
    new TextEncoder().encode(value)
      .byteLength > MAX_AUTH_HEADER_BYTES
  ) {
    return '';
  }

  const unfolded = value.replace(
    /\r\n[ \t]+/g,
    ' ',
  );

  if (
    /[\u0000-\u0008\u000a-\u001f\u007f]/
      .test(unfolded)
  ) {
    return '';
  }

  return unfolded;
}

export function interpretAuthentication(
  input: AuthenticationInput,
): AuthenticationSignals {
  const result: AuthenticationSignals = {
    spfFailed: false,
    dkimFailed: false,
    cloudflareSpam: false,
  };

  if (input.trusted !== true) {
    return result;
  }

  const headers = (
    input.authenticationResults ?? []
  ).slice(0, MAX_AUTH_HEADERS);

  for (const header of headers) {
    const cleaned = removeCommentsAndQuotes(
      safeHeader(header)
    );

    const clauses = cleaned.split(';');

    if (
      clauses.length < 2 ||
      !clauses[0].trim()
    ) {
      continue;
    }

    for (const clause of clauses.slice(1)) {
      const match = clause.trim().match(
        /^(spf|dkim)\s*=\s*([a-z]+)(?=\s|$)/i
      );

      if (!match) continue;

      const method = match[1].toLowerCase();
      const status = match[2].toLowerCase();

      if (status !== 'fail') continue;

      if (method === 'spf') {
        result.spfFailed = true;
      }

      if (method === 'dkim') {
        result.dkimFailed = true;
      }
    }
  }

  const flags = (
    input.spamFlags ?? []
  ).slice(0, MAX_AUTH_HEADERS);

  result.cloudflareSpam = flags.some(
    flag => /^(yes|true|1|spam)$/i.test(
      safeHeader(flag).trim()
    )
  );

  return result;
}
