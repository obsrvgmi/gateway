/**
 * Where to go after signing in, if it stays on this site. Parsed as a browser would, because `/\\evil.com`
 * and `//evil.com` both start with a slash and both leave.
 */
export function safeNextPath(next: string | null | undefined, origin: string): string | null {
  if (!next) return null;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
