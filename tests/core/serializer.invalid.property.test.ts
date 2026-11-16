import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PlaylistSerializer } from '../../src/core/playlist.js';
import type { Playlist, Track } from '../../src/core/types.js';

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 11 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  durationSec: fc.nat({ max: 36000 }),
  url: fc.webUrl(),
  thumbnailUrl: fc.webUrl(),
  requestedBy: fc.string({ minLength: 1, maxLength: 20 }),
});

const playlistArb: fc.Arbitrary<Playlist> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  creatorId: fc.string({ minLength: 1, maxLength: 20 }),
  guildId: fc.string({ minLength: 1, maxLength: 20 }),
  tracks: fc.array(trackArb, { minLength: 1, maxLength: 5 }),
});

const serializer = new PlaylistSerializer();

function isValidJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

// Arbitrary strings that are not JSON at all.
const nonJsonArb = fc.string({ maxLength: 100 }).filter((s) => !isValidJson(s));

// Valid JSON that is not a playlist object.
const nonObjectJsonArb = fc
  .oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null), fc.array(fc.integer()))
  .map((v) => JSON.stringify(v));

// Strict prefixes of a valid serialized playlist (an object, so never valid JSON).
const truncatedArb = playlistArb.chain((p) => {
  const json = serializer.serialize(p);
  return fc.integer({ min: 0, max: json.length - 1 }).map((n) => json.slice(0, n));
});

// Valid JSON whose fields have wrong types or violate the schema.
const wrongTypesArb = fc
  .tuple(
    playlistArb,
    fc.constantFrom(
      'version',
      'name',
      'creatorId',
      'guildId',
      'tracks',
      'trackId',
      'trackTitle',
      'trackDuration',
      'trackUrl',
      'trackThumb',
      'trackRequestedBy',
      'missingVersion',
      'emptyName',
      'emptyTracks',
    ),
    fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null), fc.array(fc.integer())),
  )
  .map(([p, field, bad]) => {
    const obj: Record<string, any> = JSON.parse(serializer.serialize(p));
    const t = obj.tracks[0];
    switch (field) {
      case 'version':
        obj.version = bad === 1 ? 'x' : bad;
        break;
      case 'name':
      case 'creatorId':
      case 'guildId':
        obj[field] = typeof bad === 'string' ? 42 : bad;
        break;
      case 'tracks':
        obj.tracks = bad;
        break;
      case 'trackId':
        t.id = typeof bad === 'string' ? 1 : bad;
        break;
      case 'trackTitle':
        t.title = typeof bad === 'string' ? 1 : bad;
        break;
      case 'trackDuration':
        t.durationSec = typeof bad === 'number' && Number.isInteger(bad) && bad >= 0 ? -1 : bad;
        break;
      case 'trackUrl':
        t.url = typeof bad === 'string' ? 1 : bad;
        break;
      case 'trackThumb':
        t.thumbnailUrl = typeof bad === 'string' ? 1 : bad;
        break;
      case 'trackRequestedBy':
        t.requestedBy = typeof bad === 'string' ? 1 : bad;
        break;
      case 'missingVersion':
        delete obj.version;
        break;
      case 'emptyName':
        obj.name = '';
        break;
      case 'emptyTracks':
        obj.tracks = [];
        break;
    }
    return JSON.stringify(obj);
  });

describe('PlaylistSerializer.deserialize invalid input property', () => {
  // Feature: discord-music-bot, Property 21: JSON inválido
  // **Validates: Requirements 4.15**
  it('returns an error with a reason and never throws for non-JSON, truncated, non-object or wrongly typed input', () => {
    fc.assert(
      fc.property(
        fc.oneof(nonJsonArb, nonObjectJsonArb, truncatedArb, wrongTypesArb),
        (input) => {
          const before = input;
          let result!: ReturnType<PlaylistSerializer['deserialize']>;
          expect(() => {
            result = serializer.deserialize(input);
          }).not.toThrow();
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(typeof result.error.reason).toBe('string');
            expect(result.error.reason.length).toBeGreaterThan(0);
          }
          expect(input).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
