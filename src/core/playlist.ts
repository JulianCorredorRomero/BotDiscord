import { err, ok, type Result } from './result.js';
import type { Playlist, Track } from './types.js';

export const MAX_PLAYLIST_NAME = 50;
export const MAX_PLAYLIST_TRACKS = 200;
export const MAX_PLAYLISTS_PER_USER = 25;
export const PLAYLIST_FORMAT_VERSION = 1;

export type SaveDecision =
  | 'ok'
  | 'confirm_overwrite'
  | 'empty'
  | 'too_many_tracks'
  | 'too_many_playlists'
  | 'bad_name';

export function validatePlaylistSave(args: {
  name: string;
  trackCount: number;
  existingNames: string[];
  userCount: number;
}): SaveDecision {
  const len = Array.from(args.name).length;
  if (len < 1 || len > MAX_PLAYLIST_NAME) return 'bad_name';
  if (args.trackCount < 1) return 'empty';
  if (args.trackCount > MAX_PLAYLIST_TRACKS) return 'too_many_tracks';
  if (args.existingNames.includes(args.name)) return 'confirm_overwrite';
  if (args.userCount >= MAX_PLAYLISTS_PER_USER) return 'too_many_playlists';
  return 'ok';
}

function orderTrack(t: Track) {
  return {
    id: t.id,
    title: t.title,
    durationSec: t.durationSec,
    url: t.url,
    thumbnailUrl: t.thumbnailUrl,
    requestedBy: t.requestedBy,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseTrack(v: unknown, i: number): Result<Track, { reason: string }> {
  if (!isObj(v)) return err({ reason: `tracks[${i}] no es un objeto` });
  for (const k of ['id', 'title', 'url', 'thumbnailUrl', 'requestedBy'] as const) {
    if (typeof v[k] !== 'string') return err({ reason: `tracks[${i}].${k} debe ser texto` });
  }
  const d = v.durationSec;
  if (typeof d !== 'number' || !Number.isInteger(d) || d < 0) {
    return err({ reason: `tracks[${i}].durationSec debe ser un entero >= 0` });
  }
  return ok(orderTrack(v as unknown as Track));
}

export class PlaylistSerializer {
  serialize(p: Playlist): string {
    return JSON.stringify({
      version: PLAYLIST_FORMAT_VERSION,
      name: p.name,
      creatorId: p.creatorId,
      guildId: p.guildId,
      tracks: p.tracks.map(orderTrack),
    });
  }

  deserialize(json: string): Result<Playlist, { reason: string }> {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      return err({ reason: 'JSON inválido' });
    }
    if (!isObj(data)) return err({ reason: 'el contenido no es un objeto' });
    if (data.version !== PLAYLIST_FORMAT_VERSION) return err({ reason: 'versión no soportada' });
    for (const k of ['name', 'creatorId', 'guildId'] as const) {
      if (typeof data[k] !== 'string') return err({ reason: `${k} debe ser texto` });
    }
    const name = data.name as string;
    const nameLen = Array.from(name).length;
    if (nameLen < 1 || nameLen > MAX_PLAYLIST_NAME) {
      return err({ reason: 'el nombre debe tener de 1 a 50 caracteres' });
    }
    if (!Array.isArray(data.tracks)) return err({ reason: 'tracks debe ser una lista' });
    if (data.tracks.length < 1 || data.tracks.length > MAX_PLAYLIST_TRACKS) {
      return err({ reason: 'tracks debe tener de 1 a 200 pistas' });
    }
    const tracks: Track[] = [];
    for (let i = 0; i < data.tracks.length; i++) {
      const r = parseTrack(data.tracks[i], i);
      if (!r.ok) return r;
      tracks.push(r.value);
    }
    return ok({
      name,
      creatorId: data.creatorId as string,
      guildId: data.guildId as string,
      tracks,
    });
  }
}
