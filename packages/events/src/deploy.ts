import { z } from "zod";

/**
 * Schema for the `data` field of a CloudEvent envelope on any
 * `idp.deploy.application.*` subject.
 *
 * Produced by the gateway webhook receiver (`POST /api/v1/webhooks/argocd`)
 * after argocd-notifications-controller fires a webhook for an Argo CD
 * Application state transition. Consumed by notification-svc's wildcard
 * subscription which fans the event out to authorized WebSocket clients.
 *
 * Field shape mirrors the JSON template configured in
 * `infra/argocd/notifications.yaml`. The four valid `trigger` values are
 * not included in this schema — they map 1:1 to the four NATS subjects
 * (synced / degraded / failed / running), so the subject already carries
 * the trigger information.
 */
export const deployApplicationEventSchema = z.object({
  /** Argo CD Application name (== service slug for lw-idp ApplicationSet). */
  app: z.string().min(1),
  /** Git revision Argo CD compared against, short SHA. */
  revision: z.string(),
  /** Argo CD sync status at the moment the trigger fired. */
  syncStatus: z.enum(["Synced", "OutOfSync", "Unknown"]),
  /** Argo CD health status. */
  healthStatus: z.enum(["Healthy", "Progressing", "Degraded", "Suspended", "Missing"]),
  /**
   * Phase of the most recent operation, if any. argocd-notifications template
   * emits an empty string when `operationState` is nil, so we accept "" as a
   * valid value rather than making the field optional.
   */
  operationPhase: z.enum(["Running", "Succeeded", "Failed", "Error", ""]).optional(),
  /** ISO-8601 timestamp when the notification was emitted. */
  at: z.string().datetime(),
});

export type DeployApplicationEvent = z.infer<typeof deployApplicationEventSchema>;
