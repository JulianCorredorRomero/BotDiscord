import fc from 'fast-check';
import { describe, it } from 'vitest';
import { Queue } from '../../src/core/queue.js';
import type { LoopMode, Track } from '../../src/core/types.js';

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 11 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  durationSec: fc.nat({ max: 36000 }),
  url: fc.webUrl(),
  thumbnailUrl: fc.webUrl(),
  requestedBy: fc.string({ minLength: 1, maxLength: 20 }),
});

const currentArb = fc.option(trackArb, { nil: null });

describe('Queue.skip property', () => {
  // Feature: discord-music-bot, Property 5: Skip avanza a la siguiente pista
  // **Validates: Requirements 2.3, 2.4**
  it('with pending tracks, current becomes the old first pending and the rest keep order', () => {
    fc.assert(
      fc.property(
        currentArb,
        fc.array(trackArb, { minLength: 1, maxLength: 50 }),
        fc.constantFrom<LoopMode>('off', 'track', 'queue'),
        (current, pending, _loop) => {
          const q = new Queue();
          q.current = current;
          q.pending = [...pending];
          const returned = q.skip();
          return (
            q.current === pending[0] &&
            returned === pending[0] &&
            q.pending.length === pending.length - 1 &&
            q.pending.every((t, i) => t === pending[i + 1])
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 5: Skip avanza a la siguiente pista
  // **Validates: Requirements 2.3, 2.4**
  it('without pending tracks, skip leaves playback idle', () => {
    fc.assert(
      fc.property(currentArb, (current) => {
        const q = new Queue();
        q.current = current;
        const returned = q.skip();
        return returned === null && q.current === null && q.pending.length === 0;
      }),
      { numRuns: 100 },
    );
  });
});
