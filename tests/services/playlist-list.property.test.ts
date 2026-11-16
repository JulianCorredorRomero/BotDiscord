import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import type { Track } from '../../src/core/types.js';
import { PlaylistService } from '../../src/services/playlistService.js';
import { SqliteStore } from '../../src/store/store.js';

const track = (i: number): Track => ({
  id: `id${i}`,
  title: `T${i}`,
  durationSec: 1,
  url: `https://y/${i}`,
  thumbnailUrl: 'th',
  requestedBy: 'u',
});

const entry = fc.record({
  guild: fc.constantFrom('g1', 'g2', 'g3'),
  user: fc.constantFrom('u1', 'u2', 'u3'),
  name: fc.string({ minLength: 1, maxLength: 10 }),
  count: fc.integer({ min: 1, max: 5 }),
});

describe('Playlist list (property)', () => {
  // Feature: discord-music-bot, Property 16: Listado de listas
  // **Validates: Requirements 4.3**
  it('Property 16: lista exactamente las listas del usuario en el servidor, ordenadas por nombre, con su número de pistas', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 40 }), (entries) => {
        const store = new SqliteStore(':memory:');
        const svc = new PlaylistService(store, new FakeClock());
        // Modelo: (guild,user) -> name -> trackCount (la última escritura gana).
        const model = new Map<string, Map<string, number>>();
        for (const e of entries) {
          const key = JSON.stringify([e.guild, e.user]);
          const res = svc.save({
            guildId: e.guild,
            userId: e.user,
            name: e.name,
            current: null,
            pending: Array.from({ length: e.count }, (_, i) => track(i)),
          });
          if (res.status === 'saved') {
            if (!model.has(key)) model.set(key, new Map());
            model.get(key)!.set(e.name, e.count);
          } else if (res.status === 'confirm_required') {
            svc.confirmSave(e.guild, e.user, e.name, true);
            model.get(key)!.set(e.name, e.count);
          }
        }
        for (const guild of ['g1', 'g2', 'g3', 'gX']) {
          for (const user of ['u1', 'u2', 'u3', 'uX']) {
            const m = model.get(JSON.stringify([guild, user])) ?? new Map<string, number>();
            const expected = [...m.entries()]
              .map(([name, trackCount]) => ({ name, trackCount }))
              .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            const r = svc.list(guild, user);
            if (expected.length === 0) expect(r).toEqual({ status: 'empty' });
            else expect(r).toEqual({ status: 'ok', playlists: expected });
          }
        }
        store.close?.();
      }),
      { numRuns: 100 },
    );
  });
});
