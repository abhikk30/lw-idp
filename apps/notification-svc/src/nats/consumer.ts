import { type Envelope, envelopeSchema } from "@lw-idp/events";
import {
  AckPolicy,
  DeliverPolicy,
  JSONCodec,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from "nats";

export interface NotificationConsumerOptions {
  nc: NatsConnection;
  /** Per-pod name prefix; a random suffix is appended for uniqueness. */
  consumerNamePrefix: string;
  /** Stream name holding idp.> — default "IDP_DOMAIN". */
  streamName?: string;
  /** Subject filter — default subjects.allWildcard ("idp.>"). */
  filterSubject?: string;
  /** Called for every decoded envelope. */
  onEnvelope: (env: Envelope) => void | Promise<void>;
  /** Called on non-fatal errors (decode, handler throw). */
  onError?: (err: unknown, ctx: { subject?: string }) => void;
}

export interface NotificationConsumerHandle {
  /** The ephemeral consumer name actually used (prefix + random). */
  consumerName: string;
  /** True iff the consume loop is actively iterating and not stopped. */
  isHealthy: () => boolean;
  /** Stop the subscription loop and tear down the consumer. */
  stop: () => Promise<void>;
}

/**
 * Start an ephemeral per-pod JetStream consumer on `idp.>`.
 *
 * Delivery:
 *  - `deliver: new` — only events published after the consumer is created.
 *    P1.6 does not provide replay; missed events while disconnected are
 *    retrieved via REST (catalog/cluster) on the client side.
 *  - `ackPolicy: none` — fire-and-forget. We are pushing to WS clients that
 *    may already have disconnected; there is no sense in ACKing to JetStream
 *    based on WS delivery success.
 *  - Ephemeral (no durable_name) — dies with the pod. A new pod gets a fresh
 *    consumer with the latest seq. Safe fan-out without queue groups.
 */
export async function startNotificationConsumer(
  opts: NotificationConsumerOptions,
): Promise<NotificationConsumerHandle> {
  const streamName = opts.streamName ?? "IDP_DOMAIN";
  const filterSubject = opts.filterSubject ?? "idp.>";

  // Append random suffix so that multiple pods with the same prefix don't collide
  // and so that pod restarts don't inherit an orphaned consumer.
  const consumerName = `${opts.consumerNamePrefix}-${Math.random().toString(36).slice(2, 10)}`;

  const jsm: JetStreamManager = await opts.nc.jetstreamManager();
  await jsm.consumers.add(streamName, {
    name: consumerName,
    ack_policy: AckPolicy.None,
    deliver_policy: DeliverPolicy.New,
    filter_subject: filterSubject,
    inactive_threshold: 300_000_000_000, // 5 minutes in nanoseconds; JetStream auto-deletes idle ephemerals
  });

  const js: JetStreamClient = opts.nc.jetstream();
  const consumer = await js.consumers.get(streamName, consumerName);

  const codec = JSONCodec<unknown>();
  let stopped = false;
  let consumerHealthy = false;
  let iter: Awaited<ReturnType<typeof consumer.consume>> | undefined;

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        iter = await consumer.consume();
        consumerHealthy = true;
        for await (const msg of iter) {
          if (stopped) {
            break;
          }
          try {
            const raw = codec.decode(msg.data);
            const parsed = envelopeSchema.safeParse(raw);
            if (!parsed.success) {
              opts.onError?.(parsed.error, { subject: msg.subject });
              continue;
            }
            await opts.onEnvelope(parsed.data);
          } catch (err) {
            opts.onError?.(err, { subject: msg.subject });
          }
        }
        // Iterator ended cleanly — only happens when consumer.stop() called
        consumerHealthy = false;
        if (stopped) {
          break;
        }
      } catch (err) {
        consumerHealthy = false;
        if (stopped) {
          break;
        }
        opts.onError?.(err, {});
        // Bounded backoff before reconnect attempt.
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }

  void loop();

  return {
    consumerName,
    isHealthy: () => consumerHealthy && !stopped,
    stop: async () => {
      stopped = true;
      consumerHealthy = false;
      try {
        iter?.stop();
      } catch {
        // ignore
      }
      try {
        await jsm.consumers.delete(streamName, consumerName);
      } catch {
        // ignore — consumer may already be gone or jsm closed
      }
    },
  };
}
