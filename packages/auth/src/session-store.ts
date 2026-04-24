import { Redis, type RedisOptions } from "ioredis";

export interface TeamRef {
  id: string;
  slug: string;
  name: string;
}

export interface SessionRecord {
  userId: string;
  subject?: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  /**
   * Team memberships at the moment this session was written (login).
   *
   * Trust model: snapshot-on-login. Not refreshed mid-session. Next refresh
   * happens on the next /auth/login → /auth/callback cycle. Session TTL
   * (SESSION_TTL_SECONDS, default 8h) bounds staleness.
   *
   * Consumers:
   *  - notification-svc authorization filter — trusts this snapshot for WS
   *    event authorization (cheap, reads session from Dragonfly).
   *  - gateway-svc GET /api/v1/me — re-fetches live from identity-svc for
   *    accuracy in the one UI surface that displays teams prominently.
   *
   * If a team membership change must take effect sooner, call
   *   sessionStore.delete(sid)
   * to force the next request to re-login. Out of scope for P1.6.
   */
  teams: TeamRef[];
  createdAt: string;
}

export interface SessionStoreSetOptions {
  ttlSeconds: number;
}

export interface SessionStore {
  get(key: string): Promise<SessionRecord | undefined>;
  set(key: string, value: SessionRecord, opts: SessionStoreSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Options for `createRedisSessionStore`.
 *
 * Exactly one of `url` or `client` must be provided:
 *  - `url`: the store owns the underlying ioredis client and will `quit()` it
 *    on `.close()`.
 *  - `client`: an externally-owned ioredis client (typically constructed via
 *    `createRedis()` in `@lw-idp/service-kit`). The store will NOT close this
 *    client on `.close()` — the caller retains lifecycle ownership.
 */
export type RedisSessionStoreOptions = {
  keyPrefix?: string;
} & (
  | { url: string; redisOptions?: RedisOptions; client?: never }
  | { client: Redis; url?: never; redisOptions?: never }
);

export function createRedisSessionStore(opts: RedisSessionStoreOptions): SessionStore {
  const owned = opts.client === undefined;
  const client: Redis = opts.client ?? new Redis(opts.url as string, opts.redisOptions ?? {});
  const prefix = opts.keyPrefix ?? "lw-idp:session:";

  return {
    async get(key) {
      const raw = await client.get(prefix + key);
      if (!raw) {
        return undefined;
      }
      try {
        return JSON.parse(raw) as SessionRecord;
      } catch {
        return undefined;
      }
    },
    async set(key, value, setOpts) {
      await client.set(prefix + key, JSON.stringify(value), "EX", setOpts.ttlSeconds);
    },
    async delete(key) {
      await client.del(prefix + key);
    },
    async close() {
      if (owned) {
        await client.quit();
      }
    },
  };
}
