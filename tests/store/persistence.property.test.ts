import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../../src/store/store.js';
import type { Playlist, Track } from '../../src/core/types.js';

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  title: fc.string({ maxLength: 40 }),
  durationSec: fc.nat({ max: 100000 }),
  url: fc.webUrl(),
  thumbnailUrl: fc.webUrl(),
  requestedBy: fc.string({ minLength: 1, maxLength: 20 }),
});

const playlistArb: fc.Arbitrary<Playlist> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  creatorId: fc.stringMatching(/^[0-9]{1,20}$/),
  guildId: fc.stringMatching(/^[0-9]{1,20}$/),
  tracks: fc.array(trackArb, { minLength: 1, maxLength: 8 }),
});

// Feature: discord-music-bot, Property 19: Persistencia de listas tras reinicio
describe('Property 19: Persistencia de listas tras reinicio', () => {
  it('cerrar y reabrir el Almacén devuelve las mismas listas', () => {
    // **Validates: Requirements 4.12**
    const dir = mkdtempSync(join(tmpdir(), 'persist-'));
    let n = 0;
    try {
      fc.assert(
        fc.property(fc.array(playlistArb, { minLength: 1, maxLength: 5 }), (lists) => {
          const file = join(dir, `db-${n++}.sqlite`);
          const s1 = new SqliteStore(file);
          // La última escritura gana para una misma clave (guild, creador, nombre).
          const expected = new Map<string, Playlist>();
          for (const p of lists) {
            expect(s1.savePlaylist(p).ok).toBe(true);
            expected.set(JSON.stringify([p.guildId, p.creatorId, p.name]), p);
          }
          s1.close();

          const s2 = new SqliteStore(file);
          try {
            for (const p of expected.values()) {
              const r = s2.getPlaylist(p.guildId, p.creatorId, p.name);
              expect(r.ok).toBe(true);
              if (r.ok) expect(r.value).toEqual(p);
            }
          } finally {
            s2.close();
          }
        }),
        { numRuns: 100 },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
