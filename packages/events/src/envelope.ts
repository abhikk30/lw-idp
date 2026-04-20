import { ulid } from "ulid";
import { z } from "zod";

export const envelopeSchema = z.object({
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  specVersion: z.literal("1.0"),
  source: z.string().min(1),
  type: z.string().min(1),
  time: z.string().datetime(),
  traceId: z.string().optional(),
  actor: z.object({ userId: z.string().optional(), teamId: z.string().optional() }).optional(),
  data: z.record(z.unknown()),
});

export type Envelope = z.infer<typeof envelopeSchema>;

export interface CreateEnvelopeInput {
  type: string;
  source: string;
  data: Record<string, unknown>;
  actor?: { userId?: string; teamId?: string };
  traceId?: string;
}

export function createEnvelope(input: CreateEnvelopeInput): Envelope {
  const env: Envelope = {
    id: ulid(),
    specVersion: "1.0",
    source: input.source,
    type: input.type,
    time: new Date().toISOString(),
    data: input.data,
  };
  if (input.actor !== undefined) {
    env.actor = input.actor;
  }
  if (input.traceId !== undefined) {
    env.traceId = input.traceId;
  }
  return env;
}
