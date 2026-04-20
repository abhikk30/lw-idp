import { startServer } from "@lw-idp/service-kit";

const port = Number(process.env.PORT ?? 4003);

await startServer({ name: "cluster-svc", port });
