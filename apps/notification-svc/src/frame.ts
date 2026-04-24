import type { Envelope } from "@lw-idp/events";

export interface OutFrame {
  id: string;
  type: string;
  entity: string;
  action: string;
  payload: Record<string, unknown>;
  ts: string;
  traceId?: string;
}

/**
 * Convert an NATS envelope to the outbound WS frame.
 * Envelope.type format: "idp.{domain}.{entity}.{action}" — we take the last
 * two segments for entity + action; the rest is preserved in `type`.
 * If type has fewer than 2 dot-separated segments, entity/action fall back
 * to the full type string and "unknown" respectively.
 */
export function envelopeToFrame(env: Envelope): OutFrame {
  const parts = env.type.split(".");
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  const action = last ?? "unknown";
  const entity = secondLast ?? env.type;
  const frame: OutFrame = {
    id: env.id,
    type: env.type,
    entity,
    action,
    payload: env.data,
    ts: env.time,
  };
  if (env.traceId !== undefined) {
    frame.traceId = env.traceId;
  }
  return frame;
}
