import { startServer } from "@lw-idp/service-kit";

const port = Number(process.env.PORT ?? 4001);

await startServer({ name: "identity-svc", port });
