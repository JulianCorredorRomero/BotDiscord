import fc from 'fast-check';
import { describe, it } from 'vitest';
import { MAX_QUEUE_SIZE, Queue } from '../../src/core/queue.js';
import type { Track } from '../../src/core/types.js';

const trackArb = (prefix: string): fc.Arbitrary<Track> =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 11 }),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    durationSec: fc.nat({ max: 20000 }),
    url: fc.constant('https://y/x'),
    thumbnailUrl: fc.constant('t'),
    requestedBy: fc.string({ minLength: 1, maxLength: 8 }),
  }).map((t) => ({ ...t, id: `${prefix}-${t.id}` }));

const makeTracks = (prefix: string, max: number) =>
  fc.array(trackArb(prefix), { maxLength: max });

describe('Queue.add', () => {
  // Feature: discord-music-bot, Property 2: Añadir pistas respeta orden y límite de 500
  // **Validates: Requirements 1.5, 7.6, 7.9**
  it('Property 2: appends the first min(|batch|, 500 - n) tracks in order, rejects the rest', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_QUEUE_SIZE }),
        makeTracks('batch', 600),
        (n, batch) => {
          const q = new Queue();
          const initial: Track[] = Array.from({ length: n }, (_, i) => ({
            id: `init-${i}`,
            title: `t${i}`,
            durationSec: i,
            url: 'u',
            thumbnailUrl: 't',
            requestedBy: 'u',
          }));
          q.pending = [...initial];

          const res = q.add(batch);
          const expectedAdded = Math.min(batch.length, MAX_QUEUE_SIZE - n);

          return (
            res.added === expectedAdded &&
            res.rejected === batch.length - expectedAdded &&
            res.firstPosition === n + 1 &&
            q.pending.length === n + expectedAdded &&
            q.pending.length <= MAX_QUEUE_SIZE &&
            initial.every((t, i) => q.pending[i] === t) &&
            batch.slice(0, expectedAdded).every((t, i) => q.pending[n + i] === t)
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
