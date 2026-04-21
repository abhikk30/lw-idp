import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EnvValidationError, loadEnv } from "../src/index.js";

describe("loadEnv", () => {
  const Env = z.object({
    PG_DSN: z.string().url(),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  });

  it("parses valid env + coerces types + applies defaults", () => {
    const env = loadEnv(Env, {
      PG_DSN: "postgresql://x:y@z:5432/db",
      PORT: "4100",
    });
    expect(env.PG_DSN).toBe("postgresql://x:y@z:5432/db");
    expect(env.PORT).toBe(4100);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("throws EnvValidationError with issue paths when missing required", () => {
    try {
      loadEnv(Env, { PORT: "4100" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const e = err as EnvValidationError;
      expect(e.message).toMatch(/PG_DSN/);
      expect(e.issues.some((i) => i.path.includes("PG_DSN"))).toBe(true);
    }
  });

  it("throws on invalid enum value", () => {
    expect(() => loadEnv(Env, { PG_DSN: "postgresql://x:y@z/db", LOG_LEVEL: "trace" })).toThrow(
      EnvValidationError,
    );
  });

  it("throws on non-URL PG_DSN", () => {
    expect(() => loadEnv(Env, { PG_DSN: "not-a-url" })).toThrow(EnvValidationError);
  });
});
