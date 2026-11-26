export const LINK_HEAVY_THRESHOLD = 0.5;

export const MAX_CONTENT_SCAN_CHARS = 500_000;

export interface LinkContentAnalysis {
  linkCount: number;
  linkCharacters: number;
  contentCharacters: number;
  linkRatio: number;
  linkHeavy: boolean;
  truncated: boolean;
}

function countVisibleCharacters(
  value: string,
): number {
  let count = 0;

  for (const char of value) {
    if (!/\s/u.test(char)) {
      count++;
    }
  }

  return count;
}

function validWebUrl(
  value: string,
): boolean {
  try {
    const url = new URL(value);

    return (
      (
        url.protocol === 'https:' ||
        url.protocol === 'http:'
      ) &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

export function analyzeLinkContent(
  body: string,
): LinkContentAnalysis {
  const content = body.slice(
    0,
    MAX_CONTENT_SCAN_CHARS,
  );

  const truncated =
    body.length > MAX_CONTENT_SCAN_CHARS;

  const contentCharacters =
    countVisibleCharacters(content);

  let linkCount = 0;
  let linkCharacters = 0;

  const pattern =
    /https?:\/\/[^\s<>"'`]+/giu;

  for (const match of content.matchAll(pattern)) {
    const candidate = match[0].replace(
      /[.,;!?)}\]]+$/u,
      '',
    );

    if (!validWebUrl(candidate)) {
      continue;
    }

    linkCount++;

    linkCharacters +=
      countVisibleCharacters(candidate);
  }

  const linkRatio =
    contentCharacters === 0
      ? 0
      : Math.min(
          1,
          linkCharacters / contentCharacters,
        );

  return {
    linkCount,
    linkCharacters,
    contentCharacters,
    linkRatio,
    linkHeavy:
      linkCount > 0 &&
      linkRatio >= LINK_HEAVY_THRESHOLD,
    truncated,
  };
}

export function hasEmptySubjectLinkHeavyBody(
  subject: string,
  body: string,
): boolean {
  if (subject.trim().length !== 0) {
    return false;
  }

  return analyzeLinkContent(body).linkHeavy;
}
