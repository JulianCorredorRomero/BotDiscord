import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { FakeClock } from '../../src/core/clock.js';
import { RateLimiter } from '../../src/core/rateLimiter.js';

// Feature: discord-music-bot, Property 30: Límite de uso por ventana deslizante
describe('Property 30: Límite de uso por ventana deslizante', () => {
  it('coincide con el modelo de referencia (Validates: Requirements 8.7)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 6000 }), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 100_000 }),
        (deltas, start) => {
          const clock = new FakeClock(start);
          const limiter = new RateLimiter(clock);
          const allowedTimes: number[] = [];
          for (const d of deltas) {
            clock.advance(d);
            const now = clock.now();
            const window = allowedTimes.filter((t) => t > now - 10_000);
            const res = limiter.check('u');
            if (window.length < 5) {
              expect(res).toEqual({ allowed: true });
              allowedTimes.push(now);
            } else {
              const expected = Math.ceil((window[0]! + 10_000 - now) / 1000);
              expect(res).toEqual({ allowed: false, retryAfterSec: expected });
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
