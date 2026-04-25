/**
 * Returns true iff `value` is a safe same-origin redirect target.
 *
 * Allows: leading-slash absolute paths only ("/services", "/?foo=bar").
 * Rejects: absolute URLs (http://, https://, javascript:, data:),
 *          protocol-relative URLs ("//evil.com"),
 *          bare paths ("services", relative paths),
 *          anything that doesn't start with a single forward slash.
 *
 * Used on both web (defensive — drops the param before forwarding to gateway)
 * and gateway-svc (authoritative — falls through to defaultRedirect when
 * isSafeRedirect(value) is false).
 */
export function isSafeRedirect(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.startsWith("//")) {
    return false;
  }
  if (/^[a-z][a-z0-9+\-.]*:/i.test(value)) {
    return false;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  return true;
}
