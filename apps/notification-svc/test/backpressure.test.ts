import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/backpressure.js";

describe("TokenBucket", () => {
  it("starts full at burst capacity", () => {
    const b = new TokenBucket({ perSec: 100, burst: 5, now: () => 0 });
    expect(b.remaining()).toBe(5);
  });

  it("take() drains one token per call", () => {
    const b = new TokenBucket({ perSec: 100, burst: 3, now: () => 0 });
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false); // drained
  });

  it("refills linearly between take() calls", () => {
    let t = 0;
    const b = new TokenBucket({ perSec: 10, burst: 2, now: () => t });
    b.take();
    b.take(); // drained
    expect(b.take()).toBe(false);
    t = 1000; // +1s → +10 tokens, but capped at burst=2
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  it("caps refill at burst", () => {
    let t = 0;
    const b = new TokenBucket({ perSec: 1, burst: 3, now: () => t });
    b.take(); // 2 left
    t = 10_000; // would gain 10 tokens — cap at burst=3
    expect(b.remaining()).toBe(3);
  });
});
