import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Queue } from '../../src/core/queue.js';
import type { Track } from '../../src/core/types.js';

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  title: fc.string({ maxLength: 10 }),
  durationSec: fc.nat({ max: 10000 }),
  url: fc.string({ maxLength: 10 }),
  thumbnailUrl: fc.string({ maxLength: 10 }),
  requestedBy: fc.string({ maxLength: 6 }),
});

const key = (t: Track): string => JSON.stringify(t);

describe('Queue.shuffle', () => {
  // Feature: discord-music-bot, Property 8: Shuffle es una permutación de las pendientes
  // **Validates: Requirements 2.9**
  it('conserva la pista actual y deja las pendientes como permutación de las originales', () => {
    fc.assert(
      fc.property(
        fc.option(trackArb, { nil: null }),
        fc.array(trackArb, { maxLength: 60 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), {
          minLength: 1,
          maxLength: 60,
        }),
        (current, pending, randoms) => {
          const q = new Queue();
          q.current = current;
          q.pending = [...pending];
          let i = 0;
          q.shuffle(() => randoms[i++ % randoms.length] as number);

          expect(q.current).toBe(current);
          expect(q.pending.length).toBe(pending.length);
          expect(q.pending.map(key).sort()).toEqual(pending.map(key).sort());
        },
      ),
      { numRuns: 100 },
    );
  });
});
