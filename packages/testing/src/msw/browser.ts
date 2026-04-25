import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.js";

export function createMswWorker(): ReturnType<typeof setupWorker> {
  return setupWorker(...handlers);
}
