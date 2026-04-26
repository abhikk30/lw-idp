import type { SessionRecord } from "@lw-idp/auth";
import type { Envelope } from "@lw-idp/events";
import { describe, expect, it, vi } from "vitest";
import { TokenBucket } from "../src/backpressure.js";
import { fanOut } from "../src/fanout.js";
import { ConnectionRegistry } from "../src/registry.js";

function mkSession(userId: string, teamSlugs: string[] = ["team-0"]): SessionRecord {
  // ID == slug here so callers can predict authz outcomes against fixture data.
  return {
    userId,
    email: `${userId}@test`,
    displayName: userId,
    teams: teamSlugs.map((s) => ({ id: s, slug: s, name: s })),
    createdAt: new Date().toISOString(),
  };
}

const fixture: Envelope = {
  id: "01HXYZABCDEFGHJKMNPQRSTVWX",
  specVersion: "1.0",
  source: "catalog-svc",
  type: "idp.catalog.service.created",
  time: new Date().toISOString(),
  data: { id: "svc-1", owner_team_id: "team-0" },
};

describe("fanOut", () => {
  it("delivers to all matching connections, counts recipients", () => {
    const r = new ConnectionRegistry();
    const send = vi.fn();
    r.add(mkSession("u-1"), new TokenBucket({ perSec: 100, burst: 100 }), send);
    r.add(mkSession("u-2"), new TokenBucket({ perSec: 100, burst: 100 }), send);
    const log = { info: vi.fn(), warn: vi.fn() };
    const recipients = fanOut(fixture, { registry: r, log, debugLog: false });
    expect(recipients).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(log.info).not.toHaveBeenCalled();
  });

  it("skips authz-rejected connections without sending", () => {
    const r = new ConnectionRegistry();
    const send = vi.fn();
    // session in team-z does not match owner_team_id team-0 (no admin team)
    r.add(mkSession("u-1", ["team-z"]), new TokenBucket({ perSec: 100, burst: 100 }), send);
    const log = { info: vi.fn(), warn: vi.fn() };
    const recipients = fanOut(fixture, { registry: r, log, debugLog: false });
    expect(recipients).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("emits info log when debugLog=true", () => {
    const r = new ConnectionRegistry();
    r.add(mkSession("u-1"), new TokenBucket({ perSec: 100, burst: 100 }), vi.fn());
    const log = { info: vi.fn(), warn: vi.fn() };
    fanOut(fixture, { registry: r, log, debugLog: true });
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "idp.catalog.service.created",
        recipients: 1,
        totalConnections: 1,
      }),
      "fan-out",
    );
  });

  it("does not emit info log when debugLog=false", () => {
    const r = new ConnectionRegistry();
    r.add(mkSession("u-1"), new TokenBucket({ perSec: 100, burst: 100 }), vi.fn());
    const log = { info: vi.fn(), warn: vi.fn() };
    fanOut(fixture, { registry: r, log, debugLog: false });
    expect(log.info).not.toHaveBeenCalled();
  });
});
