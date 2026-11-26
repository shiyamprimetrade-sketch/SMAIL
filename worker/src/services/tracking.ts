type ImageAttributes = Record<string, string | undefined>;

function dimension(
  value: string | undefined,
): number | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();

  if (!/^\d{1,8}(?:\.\d{1,4})?(?:px)?$/.test(normalized)) {
    return null;
  }

  const number = Number(
    normalized.replace(/px$/, ''),
  );

  return Number.isFinite(number)
    ? number
    : null;
}

export function isTrackingPixel(
  attrs: ImageAttributes,
): boolean {
  const width = dimension(attrs.width);
  const height = dimension(attrs.height);

  if (width === 0 || height === 0) {
    return true;
  }

  if (
    width !== null &&
    height !== null &&
    width <= 1 &&
    height <= 1
  ) {
    return true;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      attrs, 'hidden',
    )
  ) {
    return true;
  }

  const style = (attrs.style ?? '')
    .toLowerCase();

  const declarations = new Map<string, string>();

  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');

    if (separator < 0) continue;

    const property = declaration
      .slice(0, separator)
      .trim();

    const value = declaration
      .slice(separator + 1)
      .replace(/\s*!important\s*$/, '')
      .trim();

    declarations.set(property, value);
  }

  if (
    declarations.get('display') === 'none' ||
    declarations.get('visibility') === 'hidden' ||
    declarations.get('visibility') === 'collapse'
  ) {
    return true;
  }

  const opacity = declarations.get('opacity');

  if (
    opacity !== undefined &&
    opacity !== '' &&
    Number(opacity) === 0
  ) {
    return true;
  }

  const cssWidth = dimension(
    declarations.get('width'),
  ) ?? width;

  const cssHeight = dimension(
    declarations.get('height'),
  ) ?? height;

  if (cssWidth === 0 || cssHeight === 0) {
    return true;
  }

  return (
    cssWidth !== null &&
    cssHeight !== null &&
    cssWidth <= 1 &&
    cssHeight <= 1
  );
}
