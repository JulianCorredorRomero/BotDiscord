import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import { Queue, MAX_QUEUE_SIZE } from '../../src/core/queue.js';
import type { Track } from '../../src/core/types.js';
import { PlaylistService } from '../../src/services/playlistService.js';
import { SqliteStore } from '../../src/store/store.js';

const trackArb = (prefix: string): fc.Arbitrary<Track> =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 11 }).map((s) => `${prefix}-${s}`),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    durationSec: fc.nat({ max: 36000 }),
    url: fc.constant('https://www.youtube.com/watch?v=x'),
    thumbnailUrl: fc.constant('https://i.ytimg.com/vi/x/0.jpg'),
    requestedBy: fc.constantFrom('u1', 'u2', 'u3'),
  });

describe('Property 15: Cargar una lista añade al final', () => {
  // Feature: discord-music-bot, Property 15: Cargar una lista añade al final
  /** **Validates: Requirements 4.2** */
  it('la cola resultante es la original seguida de las pistas de la lista, hasta el límite de 500', () => {
    fc.assert(
      fc.property(
        fc.option(trackArb('cur'), { nil: null }),
        fc.array(trackArb('q'), { maxLength: MAX_QUEUE_SIZE }),
        fc.array(trackArb('pl'), { minLength: 1, maxLength: 200 }),
        (current, initial, listTracks) => {
          const store = new SqliteStore(':memory:');
          try {
            const svc = new PlaylistService(store, new FakeClock());
            const saved = svc.save({
              guildId: 'g',
              userId: 'u',
              name: 'mix',
              current: null,
              pending: listTracks,
            });
            expect(saved.status).toBe('saved');

            const queue = new Queue();
            queue.current = current;
            queue.pending = initial.map((t) => ({ ...t }));
            const before = initial.map((t) => ({ ...t }));

            const res = svc.load({ guildId: 'g', userId: 'u', name: 'mix', queue });
            expect(res.status).toBe('loaded');

            const room = Math.max(0, MAX_QUEUE_SIZE - before.length);
            const expectedAdded = listTracks.slice(0, room);
            expect(queue.pending).toEqual([...before, ...expectedAdded]);
            expect(queue.pending.slice(0, before.length)).toEqual(before);
            expect(queue.current).toEqual(current);
            expect(queue.pending.length).toBeLessThanOrEqual(MAX_QUEUE_SIZE);
            if (res.status === 'loaded') {
              expect(res.added).toBe(expectedAdded.length);
              expect(res.rejected).toBe(listTracks.length - expectedAdded.length);
            }
          } finally {
            store.close?.();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
