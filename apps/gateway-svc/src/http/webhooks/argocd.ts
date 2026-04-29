import { timingSafeEqual } from "node:crypto";
import { createEnvelope, deployApplicationEventSchema, subjects } from "@lw-idp/events";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { JSONCodec, type NatsConnection } from "nats";
import { z } from "zod";

export interface ArgocdWebhookPluginOptions {
  /** Shared bearer secret; validated against X-Lw-Idp-Webhook-Token using timingSafeEqual. */
  webhookToken: string;
  /** Injectable NatsConnection — injected for tests, real connection in production. */
  nats: NatsConnection;
}

/**
 * Wire shape that argocd-notifications-controller POSTs to this endpoint.
 * Extends deployApplicationEventSchema with the `trigger` field that D1
 * templates hard-code in the JSON body. After validation we map `trigger` to
 * a NATS subject and store the remaining fields as the event `data`.
 */
const argocdWebhookBodySchema = z
  .object({
    trigger: z.enum(["on-deployed", "on-health-degraded", "on-sync-failed", "on-sync-running"]),
  })
  .and(deployApplicationEventSchema);

type ArgocdWebhookBody = z.infer<typeof argocdWebhookBodySchema>;

const TRIGGER_TO_SUBJECT: Record<ArgocdWebhookBody["trigger"], string> = {
  "on-deployed": subjects.deployApplicationSynced,
  "on-health-degraded": subjects.deployApplicationDegraded,
  "on-sync-failed": subjects.deployApplicationFailed,
  "on-sync-running": subjects.deployApplicationRunning,
};

const jc = JSONCodec<unknown>();

const argocdWebhookPluginFn: FastifyPluginAsync<ArgocdWebhookPluginOptions> = async (
  fastify,
  opts,
) => {
  const expectedBuf = Buffer.from(opts.webhookToken);

  fastify.post("/api/v1/webhooks/argocd", async (req, reply) => {
    // ── 1. Bearer verification ──────────────────────────────────────────────
    const received = req.headers["x-lw-idp-webhook-token"];
    if (typeof received !== "string") {
      req.log.warn("argocd webhook: missing X-Lw-Idp-Webhook-Token header");
      return reply
        .code(401)
        .send({ code: "webhook_unauthorized", message: "missing or invalid webhook token" });
    }

    // timingSafeEqual requires same-length buffers; check length first to
    // short-circuit without leaking timing information about the expected token.
    const receivedBuf = Buffer.from(received);
    if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
      req.log.warn("argocd webhook: invalid X-Lw-Idp-Webhook-Token header");
      return reply
        .code(401)
        .send({ code: "webhook_unauthorized", message: "missing or invalid webhook token" });
    }

    // ── 2. Body validation ──────────────────────────────────────────────────
    const parsed = argocdWebhookBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      return reply.code(400).send({ code: "invalid_body", message });
    }

    const { trigger, ...data } = parsed.data;

    // ── 3. Subject mapping ──────────────────────────────────────────────────
    const subject = TRIGGER_TO_SUBJECT[trigger];
    if (!subject) {
      return reply.code(400).send({ code: "unknown_trigger", message: `trigger=${trigger}` });
    }

    // ── 4. Build envelope and publish ───────────────────────────────────────
    const envelope = createEnvelope({
      type: subject,
      source: "gateway-svc/webhooks/argocd",
      // Re-parse the data subset to strip any extraneous fields.
      data: deployApplicationEventSchema.parse(data) as Record<string, unknown>,
    });

    opts.nats.publish(subject, jc.encode(envelope));

    req.log.info({ subject, app: data.app, revision: data.revision }, "argocd webhook published");

    // ── 5. Reply 204 ────────────────────────────────────────────────────────
    return reply.code(204).send();
  });
};

export const argocdWebhookPlugin = fp(argocdWebhookPluginFn, {
  name: "lw-idp-argocd-webhook",
});
