# ADR-011: notification-svc fan-out model

**Status:** Accepted (P1.6)
**Context:** lw-idp foundation spec §6.6, §7.4, §10.2; Plan 1.6.

## Context

notification-svc bridges NATS JetStream events to connected browser WebSocket
clients. Multi-replica deployment is required (no SPoF, spec §8.1). Two
candidate architectures considered:

### Option A — Redis pub/sub layer

Each pod has a NATS queue-group consumer (load-balanced — only one pod gets
each message). On receipt, the pod re-publishes onto a Redis channel; every
pod also subscribes to the Redis channel and delivers to its local WS clients
that are authorized for the event.

**Pros:** O(1) NATS work per event regardless of pod count.
**Cons:** Two hops; an extra moving part (Redis pub/sub) on the hot path; one
more component whose failure mode degrades real-time delivery.

### Option B — NATS as the fan-out

Each pod creates its own *ephemeral* JetStream consumer with a unique name
(no queue-group sharing). Every pod independently receives every `idp.>`
event and filters locally against its in-memory ConnectionRegistry.

**Pros:** One hop; no extra component; fewer failure modes; trivially correct.
**Cons:** Each event is decoded N times where N = pod count. At target P1
scale (2–3 pods, < 100 events/sec), this is negligible — ~300 envelope decodes
per second on the busiest pod, well under the cost of a single REST call.

## Decision

**Option B.** Each notification-svc pod runs its own ephemeral consumer on
`idp.>`, deliver=`new`, ack=`none`, with `inactive_threshold` set so JetStream
auto-cleans up consumers from crashed pods. Cross-pod fan-out is NATS itself.

## Consequences

- **Scale envelope:** revisit if pod count grows past ~20 OR per-event decode
  cost grows beyond a few milliseconds. Target threshold: per-pod decode CPU
  > 5% of total CPU budget.
- **No queue-group semantics in P1.** This is intentional — queue groups
  would silently break the fan-out invariant.
- **No durable consumer state.** Clients use REST fallbacks (catalog/cluster
  list endpoints) for missed events. P1.7 will add a `last-event-id` reconnect
  contract on the client side; the consumer model in this ADR does not need
  to change for that.
- **Code locus:** `apps/notification-svc/src/nats/consumer.ts` constructs the
  ephemeral consumer per pod; `apps/notification-svc/src/index.ts` wires the
  fan-out callback.
- **Spec deviation:** spec §6.6 mentioned a "Dragonfly sticky-routing map"
  for tracking which replica holds a given user's WS. That map is unnecessary
  with Option B — every pod gets every event, so no point-to-point routing
  is required. The spec §6.6 line is superseded by this ADR.

## Alternatives considered (not chosen)

- **Sticky-session ingress + queue group.** Requires a Redis-backed registry
  for the routing map AND careful reconnect handling. More moving parts than
  Option A; rejected.
- **Per-team JetStream subjects.** Would let each pod subscribe to only the
  subjects whose teams have connections on that pod. Premature optimization
  for current load; revisit if the per-pod decode cost ever matters.
