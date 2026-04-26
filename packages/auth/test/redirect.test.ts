import { describe, expect, it } from "vitest";
import { isSafeRedirect } from "../src/redirect.js";

describe("isSafeRedirect", () => {
  it.each([
    ["/", true],
    ["/services", true],
    ["/services/svc-1", true],
    ["/foo?bar=1", true],
    ["/foo#hash", true],
  ])("accepts safe path %s", (input, expected) => {
    expect(isSafeRedirect(input)).toBe(expected);
  });

  it.each([
    ["", false],
    ["services", false],
    ["//evil.com", false],
    ["//evil.com/path", false],
    ["http://evil.com", false],
    ["https://evil.com", false],
    ["javascript:alert(1)", false],
    ["data:text/html,<script>", false],
    ["mailto:foo@bar", false],
    ["foo://bar", false],
  ])("rejects unsafe input %s", (input, expected) => {
    expect(isSafeRedirect(input)).toBe(expected);
  });

  it("rejects non-string inputs", () => {
    expect(isSafeRedirect(undefined as unknown as string)).toBe(false);
    expect(isSafeRedirect(null as unknown as string)).toBe(false);
    expect(isSafeRedirect(123 as unknown as string)).toBe(false);
  });
});
