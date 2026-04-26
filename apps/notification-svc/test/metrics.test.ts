import type { SessionRecord } from "@lw-idp/auth";
import type { Envelope } from "@lw-idp/events";
import { register } from "prom-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenBucket } from "../src/backpressure.js";
import { fanOut } from "../src/fanout.js";
import { connectionsGauge, fanoutHistogram, shedCounter } from "../src/metrics.js";
import { ConnectionRegistry } from "../src/registry.js";

afterEach(() => {
  // Reset metrics between tests so counts don't bleed.
  fanoutHistogram.reset();
  shedCounter.reset();
  connectionsGauge.reset();
});

function mkSession(userId: string, slug = "team-a"): SessionRecord {
  return {
    userId,
    email: `${userId}@test`,
    displayName: userId,
    teams: [{ id: slug, slug, name: slug }],
    createdAt: new Date().toISOString(),
  };
}

const fixture: Envelope = {
  id: "01HXYZABCDEFGHJKMNPQRSTVWX",
  specVersion: "1.0",
  source: "catalog-svc",
  type: "idp.catalog.service.created",
  time: new Date().toISOString(),
  data: { id: "svc-1", owner_team_id: "team-a" },
};

describe("notification-svc metrics", () => {
  it("fanoutHistogram records an observation per envelope", async () => {
    const r = new ConnectionRegistry();
    r.add(mkSession("u-1"), new TokenBucket({ perSec: 100, burst: 100 }), vi.fn());
    fanOut(fixture, { registry: r, log: { info: vi.fn(), warn: vi.fn() }, debugLog: false });
    const text = await register.metrics();
    expect(text).toMatch(/lwidp_notification_fanout_seconds_count\{[^}]*\} 1/);
  });

  it("shedCounter increments when token bucket is drained", async () => {
    const r = new ConnectionRegistry();
    const drainedBucket = new TokenBucket({ perSec: 0.001, burst: 1 });
    drainedBucket.take(); // drain it
    r.add(mkSession("u-1"), drainedBucket, vi.fn());
    fanOut(fixture, { registry: r, log: { info: vi.fn(), warn: vi.fn() }, debugLog: false });
    const text = await register.metrics();
    expect(text).toMatch(
      /lwidp_notification_shed_total\{type="idp\.catalog\.service\.created"\} 1/,
    );
  });

  it("connectionsGauge inc/dec parity", async () => {
    connectionsGauge.inc();
    connectionsGauge.inc();
    connectionsGauge.dec();
    const text = await register.metrics();
    expect(text).toMatch(/lwidp_notification_connections 1$/m);
  });
});
