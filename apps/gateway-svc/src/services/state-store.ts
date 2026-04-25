import { Redis, type RedisOptions } from "ioredis";

export interface StateEntry {
  codeVerifier: string;
  redirectAfter?: string;
  nonce?: string;
}

export interface StateStore {
  put(key: string, entry: StateEntry): Promise<void>;
  take(key: string): Promise<StateEntry | undefined>;
  close(): Promise<void>;
}

/**
 * Options for `createRedisStateStore`.
 *
 * Exactly one of `url` or `client` must be provided:
 *  - `url`: the store owns the underlying ioredis client and will `quit()` it
 *    on `.close()`.
 *  - `client`: an externally-owned ioredis client. The store will NOT close
 *    this client on `.close()` — the caller retains lifecycle ownership.
 */
export type RedisStateStoreOptions = {
  keyPrefix?: string;
  ttlSeconds?: number;
} & (
  | { url: string; redisOptions?: RedisOptions; client?: never }
  | { client: Redis; url?: never; redisOptions?: never }
);

export function createRedisStateStore(opts: RedisStateStoreOptions): StateStore {
  const owned = opts.client === undefined;
  const client: Redis = opts.client ?? new Redis(opts.url as string, opts.redisOptions ?? {});
  const prefix = opts.keyPrefix ?? "lw-idp:oidc-state:";
  const ttl = opts.ttlSeconds ?? 600;

  return {
    async put(key, entry) {
      await client.set(prefix + key, JSON.stringify(entry), "EX", ttl);
    },
    async take(key) {
      // Atomic read-and-delete in a single round-trip (Redis 6.2+, Dragonfly-compatible).
      // Non-atomic GET+DEL would allow an OIDC state-replay window where two concurrent
      // /auth/callback calls with the same state could both read the entry before one
      // of them deletes it.
      const raw = (await client.call("GETDEL", prefix + key)) as string | null;
      if (!raw) {
        return undefined;
      }
      try {
        return JSON.parse(raw) as StateEntry;
      } catch {
        return undefined;
      }
    },
    async close() {
      if (owned) {
        await client.quit();
      }
    },
  };
}
