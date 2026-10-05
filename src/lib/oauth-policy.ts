export function canAutoApproveConsent(role: string | null | undefined) {
  return role === "admin";
}

// Only "/authorize" plus an optional query string is accepted, so login can't be used as an open redirect.
export function sanitizeAuthorizeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  return /^\/authorize(\?[\x21-\x7e]*)?$/.test(next) ? next : null;
}

export function buildResourceMetadataChallenge(resourceMetadataUrl: string) {
  return `Bearer resource_metadata="${resourceMetadataUrl}"`;
}
