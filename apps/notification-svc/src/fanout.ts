import type { Envelope } from "@lw-idp/events";
import { canUserSeeEvent } from "./authz.js";
import { envelopeToFrame } from "./frame.js";
import type { ConnectionRegistry } from "./registry.js";

export interface FanoutDeps {
  registry: ConnectionRegistry;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
  debugLog: boolean;
}

/**
 * Iterate connected clients, filter via authz, take a token, and send the
 * frame. Returns the number of recipients that received the frame.
 *
 * If `debugLog` is true, emits one info log per envelope with
 * `{ type, recipients, totalConnections }` — the on-call observability hook
 * gated on `NOTIF_DEBUG_LOG=1` (P1.6 review item Imp-5).
 */
export function fanOut(env: Envelope, deps: FanoutDeps): number {
  let recipients = 0;
  for (const conn of deps.registry.all()) {
    if (!canUserSeeEvent(conn.session, env)) {
      continue;
    }
    if (!conn.bucket.take()) {
      deps.registry.recordShed();
      continue;
    }
    const frame = envelopeToFrame(env);
    try {
      conn.send(JSON.stringify(frame));
      recipients += 1;
    } catch (err) {
      deps.log.warn({ err, connId: conn.id }, "ws-send failed");
    }
  }
  if (deps.debugLog) {
    deps.log.info(
      { type: env.type, recipients, totalConnections: deps.registry.all().length },
      "fan-out",
    );
  }
  return recipients;
}
