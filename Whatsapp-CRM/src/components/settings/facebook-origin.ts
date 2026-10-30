/**
 * Whether a postMessage came from Meta's own site: https, and the host is
 * facebook.com or one of its subdomains (www., web., business.). Matched
 * on the parsed host, so "evilfacebook.com" or "facebook.com.evil.io"
 * never pass.
 */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.port) return false;
    return url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com');
  } catch {
    return false;
  }
}
