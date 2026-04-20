import { startServer } from "@lw-idp/service-kit";

const port = Number(process.env.PORT ?? 4000);

await startServer({ name: "gateway-svc", port });
