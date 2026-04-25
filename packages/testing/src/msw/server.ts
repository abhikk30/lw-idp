import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

export function createMswServer(): ReturnType<typeof setupServer> {
  return setupServer(...handlers);
}
