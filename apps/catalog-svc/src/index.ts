import { startServer } from "@lw-idp/service-kit";

const port = Number(process.env.PORT ?? 4002);

await startServer({ name: "catalog-svc", port });
