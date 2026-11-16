import type { Clock } from './clock.js';

export type RateCheck = { allowed: true } | { allowed: false; retryAfterSec: number };

/** Ventana deslizante por usuario: `limit` comandos permitidos cada `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly limit = 5,
    private readonly windowMs = 10_000,
  ) {}

  check(userId: string): RateCheck {
    const now = this.clock.now();
    const recent = (this.hits.get(userId) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      const retryMs = recent[0]! + this.windowMs - now;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return { allowed: true };
  }
}
