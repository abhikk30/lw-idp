import { Redis, type RedisOptions } from "ioredis";

/**
 * Construct a single shared ioredis client for a service process.
 *
 * Services should create exactly one client at boot and pass it into every
 * consumer that needs Redis (session store, state store, rate-limit,
 * idempotency, etc.) via a `client:` option. The boot script owns the
 * lifecycle — it is responsible for calling `client.quit()` on shutdown.
 *
 * Consumers that receive an injected client MUST NOT call `client.quit()` on
 * their own close paths; closing is the owner's job.
 */
export function createRedis(url: string, opts?: RedisOptions): Redis {
  return new Redis(url, opts ?? {});
}

export { Redis };
export type { RedisOptions };
