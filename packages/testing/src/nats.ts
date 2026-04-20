import { NatsContainer, type StartedNatsContainer } from "@testcontainers/nats";

export interface NatsHandle {
  url: string;
  stop(): Promise<void>;
}

export async function startNats(opts?: { image?: string }): Promise<NatsHandle> {
  const image = opts?.image ?? "nats:2.10-alpine";
  const container: StartedNatsContainer = await new NatsContainer(image)
    .withArg("-js", "")
    .withReuse()
    .start();
  return {
    url: `nats://${container.getHost()}:${container.getMappedPort(4222)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
