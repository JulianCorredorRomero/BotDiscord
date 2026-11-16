import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PlaylistSerializer } from '../../src/core/playlist.js';
import type { Playlist, Track } from '../../src/core/types.js';

const ser = new PlaylistSerializer();

const codePoint = fc.oneof(
  fc.fullUnicode(),
  fc.constantFrom('🎵', '😀', 'ñ', 'ç', '日', '"', '\\', '\n', '\u2028'),
);

/** Texto de `min`..`max` puntos de código (Unicode/emoji incluidos). */
const text = (min: number, max: number) =>
  fc.array(codePoint, { minLength: min, maxLength: max }).map((a) => a.join(''));

const nameArb = fc.oneof(
  { weight: 1, arbitrary: text(1, 1) },
  { weight: 1, arbitrary: text(50, 50) },
  { weight: 4, arbitrary: text(1, 50) },
);

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: text(1, 20),
  title: text(1, 100),
  durationSec: fc.integer({ min: 0, max: 100000 }),
  url: text(1, 60),
  thumbnailUrl: text(0, 60),
  requestedBy: text(1, 20),
});

const playlistArb: fc.Arbitrary<Playlist> = fc.record({
  name: nameArb,
  creatorId: text(1, 20),
  guildId: text(1, 20),
  tracks: fc.oneof(
    { weight: 1, arbitrary: fc.array(trackArb, { minLength: 1, maxLength: 1 }) },
    { weight: 1, arbitrary: fc.array(trackArb, { minLength: 200, maxLength: 200 }) },
    { weight: 4, arbitrary: fc.array(trackArb, { minLength: 1, maxLength: 200 }) },
  ),
});

describe('PlaylistSerializer round trip', () => {
  // Feature: discord-music-bot, Property 20: Ida y vuelta del serializador
  // **Validates: Requirements 4.13, 4.14**
  it('deserialize(serialize(p)) equals p and serialize is idempotent over the round trip', () => {
    fc.assert(
      fc.property(playlistArb, (p) => {
        const json = ser.serialize(p);
        const back = ser.deserialize(json);
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(back.value).toEqual(p);
        expect(ser.serialize(back.value)).toBe(json);
      }),
      { numRuns: 100 },
    );
  });
});
