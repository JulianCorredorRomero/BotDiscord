import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { FakeClock } from '../../src/core/clock.js';
import { PlaylistService } from '../../src/services/playlistService.js';
import { SqliteStore } from '../../src/store/store.js';
import type { Track } from '../../src/core/types.js';

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  title: fc.string({ maxLength: 40 }),
  durationSec: fc.nat({ max: 100000 }),
  url: fc.webUrl(),
  thumbnailUrl: fc.webUrl(),
  requestedBy: fc.string({ minLength: 1, maxLength: 20 }),
});

const idArb = fc.stringMatching(/^[0-9]{1,20}$/);

// Feature: discord-music-bot, Property 14: Guardar una lista conserva pistas y orden
describe('Property 14: Guardar una lista conserva pistas y orden', () => {
  it('guarda [actual, ...pendientes] en orden, asociada a usuario y servidor, y confirma nombre y número', () => {
    // **Validates: Requirements 4.1**
    fc.assert(
      fc.property(
        fc.option(trackArb, { nil: null }),
        fc.array(trackArb, { maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        idArb,
        idArb,
        (current, pending, name, userId, guildId) => {
          fc.pre(current !== null || pending.length > 0);
          const store = new SqliteStore(':memory:');
          try {
            const svc = new PlaylistService(store, new FakeClock());
            const res = svc.save({ guildId, userId, name, current, pending });
            const expected = [...(current ? [current] : []), ...pending];

            expect(res).toEqual({ status: 'saved', name, trackCount: expected.length });
            const got = store.getPlaylist(guildId, userId, name);
            expect(got.ok).toBe(true);
            if (got.ok) {
              expect(got.value).toEqual({ name, creatorId: userId, guildId, tracks: expected });
            }
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
