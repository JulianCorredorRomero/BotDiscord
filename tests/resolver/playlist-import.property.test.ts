import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Resolver, buildPlaylist, type YtDlpRunner } from '../../src/resolver/resolver.js';

interface Item {
  available: boolean;
  duration: number;
}

const itemsArb = fc.array(
  fc.record({ available: fc.boolean(), duration: fc.integer({ min: 0, max: 36000 }) }),
  { maxLength: 250 },
);

const toEntries = (items: Item[]) =>
  items.map((it, i) => ({
    id: `v${String(i).padStart(10, '0')}`,
    title: it.available ? `Pista ${i}` : (['[Private video]', '[Deleted video]'] as const)[i % 2],
    duration: it.duration,
  }));

describe('Playlist import', () => {
  // Feature: discord-music-bot, Property 3: Importación de listas de YouTube
  // **Validates: Requirements 1.3, 7.7**
  it('Property 3: toma las primeras min(100, disponibles) pistas en orden y los conteos coinciden', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const entries = toEntries(items);
        const availableIds = entries.filter((_, i) => items[i]!.available).map((e) => e.id);
        const unavailable = items.filter((i) => !i.available).length;

        const p = buildPlaylist(entries, 'user');
        const expectedIds = availableIds.slice(0, Math.min(100, availableIds.length));

        expect(p.tracks.map((t) => t.id)).toEqual(expectedIds);
        expect(p.tracks).toHaveLength(Math.min(100, availableIds.length));
        expect(p.skipped).toBe(unavailable);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 3: Importación de listas de YouTube
  // **Validates: Requirements 1.3, 7.7**
  it('Property 3: Resolver.resolve devuelve la misma importación para una URL de lista', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArb, async (items) => {
        const entries = toEntries(items);
        const run: YtDlpRunner = async () => ({
          stdout: JSON.stringify({ entries }),
          stderr: '',
          code: 0,
          timedOut: false,
        });
        const availableIds = entries.filter((_, i) => items[i]!.available).map((e) => e.id);
        const r = await new Resolver(run).resolve('https://www.youtube.com/playlist?list=PLabc123', 'user');

        if (availableIds.length === 0) {
          expect(r).toEqual({ ok: false, error: 'no_results' });
          return;
        }
        expect(r.ok).toBe(true);
        if (!r.ok || r.value.kind !== 'playlist') throw new Error('se esperaba una lista');
        expect(r.value.tracks.map((t) => t.id)).toEqual(availableIds.slice(0, 100));
        expect(r.value.skipped).toBe(items.filter((i) => !i.available).length);
      }),
      { numRuns: 100 },
    );
  });
});
