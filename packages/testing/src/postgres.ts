import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

export interface PgHandle {
  connectionString: string;
  stop(): Promise<void>;
}

export async function startPostgres(opts?: {
  image?: string;
  database?: string;
}): Promise<PgHandle> {
  const image = opts?.image ?? "postgres:16-alpine";
  const database = opts?.database ?? "lwidp_test";
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(image)
    .withDatabase(database)
    .withUsername("lwidp")
    .withPassword("lwidp")
    .withReuse()
    .start();
  return {
    connectionString: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
