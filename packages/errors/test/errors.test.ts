import { describe, expect, it } from "vitest";
import { AppError, NotFoundError, toHttpStatus } from "../src/index.js";

describe("AppError hierarchy", () => {
  it("exposes code + message + details", () => {
    const e = new NotFoundError("service not found", { slug: "payments-api" });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("not_found");
    expect(e.message).toBe("service not found");
    expect(e.details).toEqual({ slug: "payments-api" });
  });

  it("maps codes to HTTP status", () => {
    expect(toHttpStatus(new NotFoundError("x"))).toBe(404);
  });
});
