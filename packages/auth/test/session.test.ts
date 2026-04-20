import { describe, expect, it } from "vitest";
import {
  newSessionId,
  parseSessionCookie,
  serializeSessionCookie,
  sessionCookieName,
} from "../src/index.js";

describe("session helpers", () => {
  it("generates a prefixed ULID session id", () => {
    const sid = newSessionId();
    expect(sid).toMatch(/^sess_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("round-trips cookie serialize/parse", () => {
    const sid = newSessionId();
    const cookie = serializeSessionCookie(sid, { secure: true, maxAgeSeconds: 3600 });
    expect(cookie).toContain(`${sessionCookieName}=${sid}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");

    const parsed = parseSessionCookie(`${sessionCookieName}=${sid}`);
    expect(parsed).toBe(sid);
  });
});
