import { describe, expect, it } from 'vitest';
import { PlaylistSerializer, validatePlaylistSave } from '../../src/core/playlist.js';
import type { Playlist } from '../../src/core/types.js';

const sample: Playlist = {
  name: 'Mi lista 🎵',
  creatorId: 'u1',
  guildId: 'g1',
  tracks: [
    { id: 'a', title: 'Canción "uno"', durationSec: 0, url: 'https://y/a', thumbnailUrl: 't', requestedBy: 'u1' },
    { id: 'b', title: 'Dos', durationSec: 245, url: 'https://y/b', thumbnailUrl: 't2', requestedBy: 'u2' },
  ],
};

const ser = new PlaylistSerializer();

describe('PlaylistSerializer', () => {
  it('serializes with version and fixed key order', () => {
    const shuffledKeys = {
      tracks: sample.tracks.map((t) => ({
        requestedBy: t.requestedBy,
        thumbnailUrl: t.thumbnailUrl,
        url: t.url,
        durationSec: t.durationSec,
        title: t.title,
        id: t.id,
      })),
      guildId: 'g1',
      creatorId: 'u1',
      name: sample.name,
    } as Playlist;
    const s = ser.serialize(shuffledKeys);
    expect(s).toBe(ser.serialize(sample));
    expect(s.startsWith('{"version":1,"name":')).toBe(true);
    expect(s).toContain('{"id":"a","title":');
  });

  it('round trips a playlist', () => {
    const s = ser.serialize(sample);
    const r = ser.deserialize(s);
    expect(r).toEqual({ ok: true, value: sample });
    if (r.ok) expect(ser.serialize(r.value)).toBe(s);
  });

  it('returns errors without throwing on invalid input', () => {
    const cases = [
      '',
      '{',
      'null',
      '[]',
      '{"version":2,"name":"a","creatorId":"c","guildId":"g","tracks":[]}',
      '{"version":1,"name":"","creatorId":"c","guildId":"g","tracks":[]}',
      '{"version":1,"name":"a","creatorId":"c","guildId":"g","tracks":[]}',
      '{"version":1,"name":"a","creatorId":"c","guildId":"g","tracks":[{"id":1}]}',
      '{"version":1,"name":"a","creatorId":"c","guildId":"g","tracks":[{"id":"x","title":"t","durationSec":-1,"url":"u","thumbnailUrl":"t","requestedBy":"r"}]}',
      ser.serialize(sample).slice(0, -2),
    ];
    for (const c of cases) {
      const r = ser.deserialize(c);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.reason.length).toBeGreaterThan(0);
    }
  });

  it('rejects more than 200 tracks', () => {
    const big = { ...sample, tracks: Array.from({ length: 201 }, () => sample.tracks[0]!) };
    expect(ser.deserialize(ser.serialize(big)).ok).toBe(false);
  });
});

describe('validatePlaylistSave', () => {
  const base = { name: 'a', trackCount: 1, existingNames: [] as string[], userCount: 0 };

  it('applies rules in order', () => {
    expect(validatePlaylistSave(base)).toBe('ok');
    expect(validatePlaylistSave({ ...base, name: '' })).toBe('bad_name');
    expect(validatePlaylistSave({ ...base, name: 'x'.repeat(50) })).toBe('ok');
    expect(validatePlaylistSave({ ...base, name: 'x'.repeat(51) })).toBe('bad_name');
    expect(validatePlaylistSave({ ...base, trackCount: 0 })).toBe('empty');
    expect(validatePlaylistSave({ ...base, trackCount: 200 })).toBe('ok');
    expect(validatePlaylistSave({ ...base, trackCount: 201 })).toBe('too_many_tracks');
    expect(validatePlaylistSave({ ...base, existingNames: ['a'] })).toBe('confirm_overwrite');
    expect(validatePlaylistSave({ ...base, userCount: 24 })).toBe('ok');
    expect(validatePlaylistSave({ ...base, userCount: 25 })).toBe('too_many_playlists');
    expect(validatePlaylistSave({ ...base, userCount: 25, existingNames: ['a'] })).toBe('confirm_overwrite');
  });
});
