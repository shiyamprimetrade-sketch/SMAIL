export const THREAD_WINDOW_MS =
  30 * 24 * 60 * 60 * 1000;

export function normalizeSubject(
  subject: string,
): string {
  let value = subject.trim().toLowerCase();

  while (true) {
    const prefix = /^(?:re|fwd|fw)\s*:\s*/.exec(
      value
    );

    if (!prefix) break;

    value = value.slice(prefix[0].length);
  }

  return value
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMessageId(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  const id = value.trim();

  if (id.length > 998) return null;

  if (!/^<[^<>\s\u0000-\u001f\u007f]+>$/.test(id)) {
    return null;
  }

  return id;
}

export function referenceCandidates(
  references: readonly string[],
): string[] {
  const result: string[] = [];

  const seen = new Set<string>();

  // Prefer the most recent reference when
  // multiple references match different threads.
  for (let i = references.length - 1; i >= 0; i--) {
    const id = normalizeMessageId(
      references[i]
    );

    if (!id || seen.has(id)) continue;

    seen.add(id);

    result.push(id);
  }

  return result;
}

export function normalizeParticipant(
  address: string,
): string {
  const value = address.trim();

  const separator = value.lastIndexOf('@');

  if (separator < 1) return value;

  return value.slice(0, separator) +
    '@' +
    value.slice(separator + 1).toLowerCase();
}

export function withinThreadWindow(
  lastMessageAt: number,
  now: number,
): boolean {
  if (
    !Number.isSafeInteger(lastMessageAt) ||
    !Number.isSafeInteger(now) ||
    lastMessageAt < 0 ||
    now < 0 ||
    lastMessageAt > now
  ) {
    return false;
  }

  return now - lastMessageAt <= THREAD_WINDOW_MS;
}
