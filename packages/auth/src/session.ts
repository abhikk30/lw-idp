import { type SerializeOptions, parse, serialize } from "cookie";
import { ulid } from "ulid";

export const sessionCookieName = "lw-sid";

export function newSessionId(): string {
  return `sess_${ulid()}`;
}

export interface SessionCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
  domain?: string;
  path?: string;
}

export function serializeSessionCookie(sid: string, opts: SessionCookieOptions): string {
  const cookieOpts: SerializeOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: opts.secure,
    path: opts.path ?? "/",
    maxAge: opts.maxAgeSeconds,
  };
  if (opts.domain !== undefined) {
    cookieOpts.domain = opts.domain;
  }
  return serialize(sessionCookieName, sid, cookieOpts);
}

export function parseSessionCookie(cookieHeader: string | undefined | null): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const parsed = parse(cookieHeader);
  return parsed[sessionCookieName];
}
