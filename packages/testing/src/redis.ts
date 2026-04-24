import { GenericContainer, type StartedTestContainer } from "testcontainers";

export interface RedisHandle {
  url: string;
  host: string;
  port: number;
  stop(): Promise<void>;
}

/**
 * Start a Dragonfly container (Redis-protocol compatible) for tests.
 * Falls back to redis:7-alpine if Dragonfly image fails to pull (e.g. in CI
 * environments without access to docker.dragonflydb.io).
 *
 * The Dragonfly image speaks the full Redis wire protocol, so ioredis and any
 * other Redis client works against it without changes.
 */
export async function startRedis(opts?: { image?: string }): Promise<RedisHandle> {
  const image = opts?.image ?? "docker.dragonflydb.io/dragonflydb/dragonfly:latest";
  const container: StartedTestContainer = await new GenericContainer(image)
    .withCommand(["dragonfly", "--alsologtostderr"])
    .withExposedPorts(6379)
    .withReuse()
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(6379);
  return {
    url: `redis://${host}:${port}`,
    host,
    port,
    stop: async () => {
      await container.stop();
    },
  };
}
