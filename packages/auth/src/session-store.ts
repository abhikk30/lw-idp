import { Redis, type RedisOptions } from "ioredis";

export interface TeamRef {
  id: string;
  slug: string;
  name: string;
}

export interface SessionRecord {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
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

export interface RedisSessionStoreOptions {
  url: string;
  keyPrefix?: string;
  redisOptions?: RedisOptions;
}

export function createRedisSessionStore(opts: RedisSessionStoreOptions): SessionStore {
  const client = new Redis(opts.url, opts.redisOptions ?? {});
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
      await client.quit();
    },
  };
}
