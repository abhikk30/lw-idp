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

export interface RedisStateStoreOptions {
  url: string;
  keyPrefix?: string;
  ttlSeconds?: number;
  redisOptions?: RedisOptions;
}

export function createRedisStateStore(opts: RedisStateStoreOptions): StateStore {
  const client = new Redis(opts.url, opts.redisOptions ?? {});
  const prefix = opts.keyPrefix ?? "lw-idp:oidc-state:";
  const ttl = opts.ttlSeconds ?? 600;

  return {
    async put(key, entry) {
      await client.set(prefix + key, JSON.stringify(entry), "EX", ttl);
    },
    async take(key) {
      const raw = await client.get(prefix + key);
      if (!raw) {
        return undefined;
      }
      await client.del(prefix + key);
      try {
        return JSON.parse(raw) as StateEntry;
      } catch {
        return undefined;
      }
    },
    async close() {
      await client.quit();
    },
  };
}
