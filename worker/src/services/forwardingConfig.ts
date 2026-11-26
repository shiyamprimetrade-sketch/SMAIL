export interface ForwardingConfig {
  ownerEmail: string;
  destination: string;
}

function normalizeEmail(
  value: string,
): string {
  const email = value.trim();

  if (
    email.length > 254 ||
    !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email)
  ) {
    throw new Error(
      'Invalid forwarding configuration'
    );
  }

  return email.toLowerCase();
}

export function resolveForwardingConfig(
  ownerEmail: string | undefined,
  destination: string | undefined,
): ForwardingConfig {
  if (!ownerEmail || !destination) {
    throw new Error(
      'Missing forwarding configuration'
    );
  }

  const owner = normalizeEmail(
    ownerEmail
  );

  const target = normalizeEmail(
    destination
  );

  if (owner === target) {
    throw new Error(
      'Forwarding loop prohibited'
    );
  }

  const ownerDomain =
    owner.split('@')[1];

  const targetDomain =
    target.split('@')[1];

  if (ownerDomain === targetDomain) {
    throw new Error(
      'Same-domain forwarding prohibited'
    );
  }

  if (targetDomain !== 'gmail.com') {
    throw new Error(
      'Forwarding destination not permitted'
    );
  }

  return {
    ownerEmail: owner,
    destination: target,
  };
}

export function isAuthorizedRecipient(
  recipient: string,
  config: ForwardingConfig,
): boolean {
  try {
    return normalizeEmail(
      recipient
    ) === config.ownerEmail;
  } catch {
    return false;
  }
}
