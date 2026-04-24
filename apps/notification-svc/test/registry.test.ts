import type { SessionRecord } from "@lw-idp/auth";
import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/backpressure.js";
import { ConnectionRegistry } from "../src/registry.js";

function mkSession(userId: string, teamSlugs: string[] = []): SessionRecord {
  return {
    userId,
    email: `${userId}@test`,
    displayName: userId,
    teams: teamSlugs.map((s, i) => ({ id: `team-${i}`, slug: s, name: s })),
    createdAt: new Date().toISOString(),
  };
}

describe("ConnectionRegistry", () => {
  it("add returns a connection with a monotonic id", () => {
    const r = new ConnectionRegistry();
    const bucket = new TokenBucket({ perSec: 100, burst: 50 });
    const a = r.add(mkSession("u-1"), bucket, () => {});
    const b = r.add(mkSession("u-2"), bucket, () => {});
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(r.all()).toHaveLength(2);
  });

  it("remove drops the connection", () => {
    const r = new ConnectionRegistry();
    const bucket = new TokenBucket({ perSec: 100, burst: 50 });
    const c = r.add(mkSession("u-1"), bucket, () => {});
    r.remove(c.id);
    expect(r.all()).toHaveLength(0);
  });

  it("metrics counts unique users + shed totals", () => {
    const r = new ConnectionRegistry();
    const bucket = new TokenBucket({ perSec: 100, burst: 50 });
    r.add(mkSession("u-1"), bucket, () => {});
    r.add(mkSession("u-1"), bucket, () => {}); // same user, 2 conns
    r.add(mkSession("u-2"), bucket, () => {});
    r.recordShed();
    r.recordShed();
    const m = r.metrics();
    expect(m.totalConnections).toBe(3);
    expect(m.totalUsers).toBe(2);
    expect(m.sheddedTotal).toBe(2);
  });
});
