import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteStore } from '../../src/store/store.js';
import type { Playlist } from '../../src/core/types.js';

const pl = (name: string, creatorId = 'u1', guildId = 'g1'): Playlist => ({
  name,
  creatorId,
  guildId,
  tracks: [
    { id: 'a', title: 'Uno 🎵', durationSec: 10, url: 'https://y/a', thumbnailUrl: 't', requestedBy: creatorId },
    { id: 'b', title: 'Dos', durationSec: 0, url: 'https://y/b', thumbnailUrl: 't', requestedBy: creatorId },
  ],
});

describe('SqliteStore', () => {
  it('devuelve valores por defecto', () => {
    const s = new SqliteStore(':memory:');
    expect(s.getSettings('g1')).toEqual({ guildId: 'g1', volume: 50, djRoleId: null, language: 'es' });
    s.close();
  });

  it('guarda volumen, Rol_DJ e idioma de forma independiente por servidor', () => {
    const s = new SqliteStore(':memory:');
    expect(s.setVolume('g1', 80).ok).toBe(true);
    expect(s.setDjRole('g1', 'r1').ok).toBe(true);
    expect(s.setLanguage('g1', 'en').ok).toBe(true);
    expect(s.getSettings('g1')).toEqual({ guildId: 'g1', volume: 80, djRoleId: 'r1', language: 'en' });
    expect(s.setDjRole('g1', null).ok).toBe(true);
    expect(s.getDjRole('g1')).toBeNull();
    expect(s.getVolume('g1')).toBe(80);
    expect(s.getVolume('g2')).toBe(50);
    s.close();
  });

  it('devuelve error tipado si el guardado falla', () => {
    const s = new SqliteStore(':memory:');
    const r = s.setVolume('g1', 150);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('save_failed');
    expect(s.getVolume('g1')).toBe(50);
    s.close();
  });

  it('guarda, lista ordenado, sobrescribe y elimina listas', () => {
    const s = new SqliteStore(':memory:');
    s.savePlaylist(pl('b'));
    s.savePlaylist(pl('a'));
    s.savePlaylist(pl('z', 'u2'));
    expect(s.listPlaylists('g1', 'u1')).toEqual([
      { name: 'a', trackCount: 2 },
      { name: 'b', trackCount: 2 },
    ]);
    const changed = { ...pl('a'), tracks: pl('a').tracks.slice(0, 1) };
    s.savePlaylist(changed);
    const got = s.getPlaylist('g1', 'u1', 'a');
    expect(got.ok && got.value).toEqual(changed);
    expect(s.deletePlaylist('g1', 'u2', 'a')).toEqual({ ok: true, value: false });
    expect(s.deletePlaylist('g1', 'u1', 'a')).toEqual({ ok: true, value: true });
    expect(s.getPlaylist('g1', 'u1', 'a')).toEqual({ ok: true, value: null });
    s.close();
  });

  it('persiste tras cerrar y reabrir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-'));
    const file = join(dir, 'db.sqlite');
    const s = new SqliteStore(file);
    s.savePlaylist(pl('x'));
    s.setVolume('g1', 20);
    s.close();
    const s2 = new SqliteStore(file);
    const got = s2.getPlaylist('g1', 'u1', 'x');
    expect(got.ok && got.value).toEqual(pl('x'));
    expect(s2.getVolume('g1')).toBe(20);
    s2.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
