import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import { Queue } from '../../src/core/queue.js';
import type { Track } from '../../src/core/types.js';
import { PlaylistService } from '../../src/services/playlistService.js';
import { SqliteStore } from '../../src/store/store.js';

const USERS = ['u1', 'u2', 'u3'] as const;

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 11 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  durationSec: fc.nat({ max: 36000 }),
  url: fc.constant('https://www.youtube.com/watch?v=x'),
  thumbnailUrl: fc.constant('https://i.ytimg.com/vi/x/0.jpg'),
  requestedBy: fc.constantFrom(...USERS),
});

const nameArb = fc.stringMatching(/^[a-z0-9]{1,12}$/);

interface Entry {
  userId: string;
  name: string;
  tracks: Track[];
}

/** Conjunto de listas con (usuario, nombre) únicos. */
const entriesArb: fc.Arbitrary<Entry[]> = fc
  .uniqueArray(fc.tuple(fc.constantFrom(...USERS), nameArb), {
    minLength: 1,
    maxLength: 8,
    selector: ([u, n]) => `${u}/${n}`,
  })
  .chain((keys) =>
    fc.tuple(...keys.map(() => fc.array(trackArb, { minLength: 1, maxLength: 5 }))).map((tr) =>
      keys.map(([userId, name], i) => ({ userId, name, tracks: tr[i]! })),
    ),
  );

function setup(entries: Entry[]) {
  const store = new SqliteStore(':memory:');
  const svc = new PlaylistService(store, new FakeClock());
  for (const e of entries) {
    const r = svc.save({ guildId: 'g', userId: e.userId, name: e.name, current: null, pending: e.tracks });
    expect(r.status).toBe('saved');
  }
  return { store, svc };
}

function snapshot(store: SqliteStore, entries: Entry[], extraNames: string[] = []) {
  const names = [...new Set([...entries.map((e) => e.name), ...extraNames])];
  return {
    summaries: USERS.map((u) => store.listPlaylists('g', u)),
    playlists: USERS.flatMap((u) => names.map((n) => store.getPlaylist('g', u, n))),
  };
}

describe('Property 18: Acceso a listas por nombre y creador', () => {
  // Feature: discord-music-bot, Property 18: Acceso a listas por nombre y creador
  /** **Validates: Requirements 4.5, 4.7, 4.9** */
  it('load/delete de un nombre inexistente no cambia la cola ni el almacén (not_found)', () => {
    fc.assert(
      fc.property(
        entriesArb,
        nameArb,
        fc.constantFrom(...USERS),
        fc.array(trackArb, { maxLength: 10 }),
        (entries, missing, userId, queued) => {
          fc.pre(!entries.some((e) => e.name === missing));
          const { store, svc } = setup(entries);
          try {
            const queue = new Queue();
            queue.pending = queued.map((t) => ({ ...t }));
            const queueBefore = queue.pending.map((t) => ({ ...t }));
            const before = snapshot(store, entries, [missing]);

            expect(svc.load({ guildId: 'g', userId, name: missing, queue })).toEqual({ status: 'not_found' });
            expect(svc.delete({ guildId: 'g', userId, name: missing })).toEqual({ status: 'not_found' });

            expect(queue.pending).toEqual(queueBefore);
            expect(queue.current).toBeNull();
            expect(snapshot(store, entries, [missing])).toEqual(before);
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 18: Acceso a listas por nombre y creador
  /** **Validates: Requirements 4.5, 4.7, 4.9** */
  it('delete de una lista ajena se rechaza (not_creator) y el almacén no cambia', () => {
    fc.assert(
      fc.property(entriesArb, fc.constantFrom(...USERS), (entries, requester) => {
        const foreign = entries.filter(
          (e) => e.userId !== requester && !entries.some((o) => o.userId === requester && o.name === e.name),
        );
        fc.pre(foreign.length > 0);
        const { store, svc } = setup(entries);
        try {
          const before = snapshot(store, entries);
          for (const e of foreign) {
            expect(svc.delete({ guildId: 'g', userId: requester, name: e.name })).toEqual({ status: 'not_creator' });
          }
          expect(snapshot(store, entries)).toEqual(before);
        } finally {
          store.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 18: Acceso a listas por nombre y creador
  /** **Validates: Requirements 4.5, 4.7, 4.9** */
  it('delete de una lista propia elimina solo esa lista', () => {
    fc.assert(
      fc.property(entriesArb, fc.nat(), (entries, idx) => {
        const target = entries[idx % entries.length]!;
        const { store, svc } = setup(entries);
        try {
          expect(svc.delete({ guildId: 'g', userId: target.userId, name: target.name })).toEqual({
            status: 'deleted',
            name: target.name,
          });
          expect(store.getPlaylist('g', target.userId, target.name)).toEqual({ ok: true, value: null });
          for (const e of entries) {
            if (e === target) continue;
            const r = store.getPlaylist('g', e.userId, e.name);
            expect(r.ok && r.value?.tracks).toEqual(e.tracks);
          }
          for (const u of USERS) {
            const expected = entries
              .filter((e) => e.userId === u && e !== target)
              .map((e) => e.name)
              .sort();
            expect(
              store
                .listPlaylists('g', u)
                .map((s) => s.name)
                .sort(),
            ).toEqual(expected);
          }
        } finally {
          store.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});
