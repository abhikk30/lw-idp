/**
 * Token bucket for per-connection backpressure.
 * Refills linearly at `perSec` rate, capped at `burst`.
 * Uses wall clock (Date.now()) — caller does not need to tick explicitly.
 */
export class TokenBucket {
  private tokens: number;
  private readonly burst: number;
  private readonly perSec: number;
  private lastRefillMs: number;
  private readonly nowFn: () => number;

  constructor(opts: { perSec: number; burst: number; now?: () => number }) {
    this.burst = opts.burst;
    this.perSec = opts.perSec;
    this.nowFn = opts.now ?? (() => Date.now());
    this.tokens = opts.burst;
    this.lastRefillMs = this.nowFn();
  }

  take(): boolean {
    this.refill();
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  remaining(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = this.nowFn();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) {
      return;
    }
    const gained = (elapsedMs / 1000) * this.perSec;
    this.tokens = Math.min(this.burst, this.tokens + gained);
    this.lastRefillMs = now;
  }
}
