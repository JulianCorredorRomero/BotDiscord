import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Queue } from '../../src/core/queue.js';
import type { Track } from '../../src/core/types.js';

const trackArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 11 }),
  title: fc.string(),
  durationSec: fc.nat(),
  url: fc.string(),
  thumbnailUrl: fc.string(),
  requestedBy: fc.string(),
});

const tracksArb = fc.array(trackArb, { maxLength: 30 });

function build(tracks: Track[]): Queue {
  const q = new Queue();
  q.add(tracks);
  return q;
}

describe('Queue.remove', () => {
  // Feature: discord-music-bot, Property 9: Remove
  // **Validates: Requirements 2.10, 2.11**
  it('removes the item at valid position p and shifts the rest', () => {
    fc.assert(
      fc.property(
        tracksArb.filter((t) => t.length > 0),
        fc.nat(),
        (tracks, seed) => {
          const p = (seed % tracks.length) + 1;
          const q = build(tracks);
          const r = q.remove(p);
          const expected = [...tracks];
          expected.splice(p - 1, 1);
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.value).toEqual(tracks[p - 1]);
          expect(q.pending).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 9: Remove
  // **Validates: Requirements 2.10, 2.11**
  it('leaves the queue unchanged and errors for invalid positions', () => {
    fc.assert(
      fc.property(
        tracksArb,
        fc.oneof(
          fc.integer({ min: -1000, max: 0 }),
          fc.integer({ min: 31, max: 1000 }),
          fc.double({ noInteger: true, noNaN: true, min: -50, max: 50 }),
          fc.constantFrom(NaN, Infinity, -Infinity),
        ),
        (tracks, pos) => {
          const q = build(tracks);
          const n = tracks.length;
          fc.pre(!(Number.isInteger(pos) && pos >= 1 && pos <= n));
          const r = q.remove(pos);
          expect(r.ok).toBe(false);
          expect(q.pending).toEqual(tracks);
        },
      ),
      { numRuns: 100 },
    );
  });
});
