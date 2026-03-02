/**
 * Validates that a resource ID is safe to embed in a URL path segment.
 * Allows only alphanumeric characters, hyphens, and underscores.
 * Throws an error if the ID contains any disallowed characters (e.g. path
 * traversal sequences), preventing SSRF via crafted IDs.
 */
export function validateResourceId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid resource ID: contains disallowed characters`);
  }
}
