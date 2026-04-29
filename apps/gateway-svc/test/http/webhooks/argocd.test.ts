import { envelopeSchema } from "@lw-idp/events";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { JSONCodec } from "nats";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { argocdWebhookPlugin } from "../../../src/http/webhooks/argocd.js";

// ── Fake NATS connection ──────────────────────────────────────────────────────

interface PublishCall {
  subject: string;
  data: Uint8Array;
}

function makeFakeNats(): {
  calls: PublishCall[];
  nats: { publish: (subject: string, data: Uint8Array) => void };
} {
  const calls: PublishCall[] = [];
  return {
    calls,
    nats: {
      publish: vi.fn((subject: string, data: Uint8Array) => {
        calls.push({ subject, data });
      }),
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOKEN = "test-token-secret";
const TOKEN_SAME_LEN_WRONG = "test-token-WRONG!"; // same length, different value

const validBody = {
  trigger: "on-deployed",
  app: "svc-alpha",
  revision: "abc1234",
  syncStatus: "Synced",
  healthStatus: "Healthy",
  operationPhase: "Succeeded",
  at: "2026-04-27T10:00:00.000Z",
};

const jc = JSONCodec<unknown>();

function decodePublish(data: Uint8Array): unknown {
  return jc.decode(data);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("POST /api/v1/webhooks/argocd", () => {
  let server: LwIdpServer;
  let serverUrl: string;
  let fake: ReturnType<typeof makeFakeNats>;

  beforeAll(async () => {
    fake = makeFakeNats();

    server = await buildServer({
      name: "gateway-svc-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(argocdWebhookPlugin, {
          webhookToken: TOKEN,
          // Type-cast: the plugin only calls .publish(); the fake satisfies that contract.
          nats: fake.nats as never,
        });
      },
    });

    const addr = await server.listen();
    serverUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(() => {
    fake.calls.length = 0;
    vi.clearAllMocks();
  });

  function post(body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token !== undefined) {
      headers["x-lw-idp-webhook-token"] = token;
    }
    return fetch(`${serverUrl}/api/v1/webhooks/argocd`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  // ── Happy-path: all four triggers ──────────────────────────────────────────

  it("on-deployed → 204, publishes to idp.deploy.application.synced", async () => {
    const res = await post({ ...validBody, trigger: "on-deployed" }, TOKEN);
    expect(res.status).toBe(204);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].subject).toBe("idp.deploy.application.synced");

    const decoded = decodePublish(fake.calls[0].data);
    const envelope = envelopeSchema.parse(decoded);
    expect(envelope.type).toBe("idp.deploy.application.synced");
    expect(envelope.data).toMatchObject({
      app: "svc-alpha",
      revision: "abc1234",
      syncStatus: "Synced",
      healthStatus: "Healthy",
    });
    // `trigger` must NOT leak into the envelope data
    expect((envelope.data as Record<string, unknown>).trigger).toBeUndefined();
  });

  it("on-health-degraded → 204, publishes to idp.deploy.application.degraded", async () => {
    const res = await post(
      {
        ...validBody,
        trigger: "on-health-degraded",
        syncStatus: "OutOfSync",
        healthStatus: "Degraded",
      },
      TOKEN,
    );
    expect(res.status).toBe(204);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].subject).toBe("idp.deploy.application.degraded");
  });

  it("on-sync-failed → 204, publishes to idp.deploy.application.failed", async () => {
    const res = await post(
      {
        ...validBody,
        trigger: "on-sync-failed",
        syncStatus: "Unknown",
        healthStatus: "Missing",
        operationPhase: "Failed",
      },
      TOKEN,
    );
    expect(res.status).toBe(204);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].subject).toBe("idp.deploy.application.failed");
  });

  it("on-sync-running → 204, publishes to idp.deploy.application.running", async () => {
    const res = await post(
      {
        ...validBody,
        trigger: "on-sync-running",
        syncStatus: "OutOfSync",
        healthStatus: "Progressing",
        operationPhase: "Running",
      },
      TOKEN,
    );
    expect(res.status).toBe(204);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].subject).toBe("idp.deploy.application.running");
  });

  // ── Auth failures ──────────────────────────────────────────────────────────

  it("missing X-Lw-Idp-Webhook-Token → 401, NATS not called", async () => {
    const res = await post(validBody); // no token argument → no header
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("webhook_unauthorized");
    expect(fake.calls).toHaveLength(0);
  });

  it("wrong token of equal length → 401, NATS not called", async () => {
    expect(TOKEN_SAME_LEN_WRONG.length).toBe(TOKEN.length); // sanity: same length
    const res = await post(validBody, TOKEN_SAME_LEN_WRONG);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("webhook_unauthorized");
    expect(fake.calls).toHaveLength(0);
  });

  it("wrong token of different length → 401, NATS not called (no crash)", async () => {
    const res = await post(validBody, "short");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("webhook_unauthorized");
    expect(fake.calls).toHaveLength(0);
  });

  // ── Validation failures ────────────────────────────────────────────────────

  it("body missing `revision` → 400 invalid_body, NATS not called", async () => {
    const { revision: _omit, ...bodyWithoutRevision } = validBody;
    const res = await post(bodyWithoutRevision, TOKEN);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("invalid_body");
    expect(fake.calls).toHaveLength(0);
  });

  it("unknown trigger value → 400 invalid_body (enum parse failure), NATS not called", async () => {
    const res = await post({ ...validBody, trigger: "on-something-else" }, TOKEN);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    // zod rejects the enum before we even reach the subject-mapping step
    expect(body.code).toBe("invalid_body");
    expect(fake.calls).toHaveLength(0);
  });
});
