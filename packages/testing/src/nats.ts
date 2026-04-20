import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

export interface NatsHandle {
  url: string;
  stop(): Promise<void>;
}

export async function startNats(opts?: { image?: string }): Promise<NatsHandle> {
  const image = opts?.image ?? "nats:2.10-alpine";
  // NatsContainer.withArg("-js", "") incorrectly generates `nats-server -js ""`
  // which NATS rejects. Use GenericContainer directly with an explicit command.
  const container: StartedTestContainer = await new GenericContainer(image)
    .withCommand(["nats-server", "-js"])
    .withExposedPorts(4222, 6222, 8222)
    .withWaitStrategy(Wait.forLogMessage(/.*Server is ready.*/))
    .withReuse()
    .start();
  return {
    url: `nats://${container.getHost()}:${container.getMappedPort(4222)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
