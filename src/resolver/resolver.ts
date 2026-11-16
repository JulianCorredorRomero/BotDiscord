import { execFile } from 'node:child_process';
import { err, ok, type Result } from '../core/result.js';
import type { Track } from '../core/types.js';
import { classifyInput } from './classify.js';

export type ResolveError =
  | 'invalid_link'
  | 'unavailable:deleted'
  | 'unavailable:private'
  | 'unavailable:region'
  | 'age_restricted'
  | 'no_results'
  | 'timeout';

export interface ResolvedPlaylist {
  tracks: Track[];
  /** Entradas no disponibles omitidas. */
  skipped: number;
}

export type ResolveResult =
  | { kind: 'track'; track: Track }
  | ({ kind: 'playlist' } & ResolvedPlaylist);

export interface YtDlpOutput {
  stdout: string;
  stderr: string;
  /** Código de salida; 0 si fue bien. */
  code: number;
  timedOut: boolean;
}

/** Ejecuta yt-dlp con los argumentos dados. Inyectable para pruebas. */
export type YtDlpRunner = (args: string[], timeoutMs: number) => Promise<YtDlpOutput>;

export const RESOLVE_TIMEOUT_MS = 10_000;
export const AUTOCOMPLETE_TIMEOUT_MS = 3_000;
export const MAX_PLAYLIST_TRACKS = 100;
export const AUTOCOMPLETE_LIMIT = 5;

export function createYtDlpRunner(binary = 'yt-dlp'): YtDlpRunner {
  return (args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        binary,
        args,
        { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ stdout, stderr, code: 0, timedOut: false });
            return;
          }
          const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
          const timedOut = e.killed === true;
          resolve({
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? '') || e.message,
            code: typeof e.code === 'number' ? e.code : 1,
            timedOut,
          });
        },
      );
    });
}

/** Traduce el stderr de yt-dlp a un error tipado. */
export function mapYtDlpError(stderr: string): ResolveError {
  const s = stderr.toLowerCase();
  if (s.includes('private video') || s.includes('private playlist') || s.includes('this video is private')) {
    return 'unavailable:private';
  }
  if (
    s.includes('confirm your age') ||
    s.includes('age-restricted') ||
    s.includes('age restricted') ||
    s.includes('inappropriate for some users')
  ) {
    return 'age_restricted';
  }
  if (
    s.includes('not available in your country') ||
    s.includes('blocked it in your country') ||
    s.includes('blocked in your country') ||
    s.includes('who has blocked it') ||
    s.includes('geo restricted') ||
    s.includes('geo-restricted')
  ) {
    return 'unavailable:region';
  }
  if (
    s.includes('video unavailable') ||
    s.includes('has been removed') ||
    s.includes('been terminated') ||
    s.includes('deleted') ||
    s.includes('no longer available') ||
    s.includes('does not exist')
  ) {
    return 'unavailable:deleted';
  }
  return 'invalid_link';
}

interface RawEntry {
  id?: unknown;
  title?: unknown;
  duration?: unknown;
  url?: unknown;
  webpage_url?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  availability?: unknown;
}

const UNAVAILABLE_TITLES = new Set(['[private video]', '[deleted video]', '[unavailable video]']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickThumbnail(e: RawEntry, id: string): string {
  if (typeof e.thumbnail === 'string' && e.thumbnail) return e.thumbnail;
  if (Array.isArray(e.thumbnails)) {
    for (let i = e.thumbnails.length - 1; i >= 0; i--) {
      const t = e.thumbnails[i];
      if (isRecord(t) && typeof t['url'] === 'string' && t['url']) return t['url'];
    }
  }
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Convierte una entrada de yt-dlp en Track, o null si no es utilizable/disponible. */
export function entryToTrack(raw: unknown, requestedBy: string): Track | null {
  if (!isRecord(raw)) return null;
  const e = raw as RawEntry;
  if (typeof e.id !== 'string' || e.id.length === 0) return null;
  if (typeof e.title !== 'string' || e.title.length === 0) return null;
  if (UNAVAILABLE_TITLES.has(e.title.trim().toLowerCase())) return null;
  if (e.availability === 'private' || e.availability === 'needs_auth' || e.availability === 'premium_only') {
    return null;
  }
  const duration =
    typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration >= 0
      ? Math.floor(e.duration)
      : 0;
  return {
    id: e.id,
    title: e.title,
    durationSec: duration,
    url: `https://www.youtube.com/watch?v=${e.id}`,
    thumbnailUrl: pickThumbnail(e, e.id),
    requestedBy,
  };
}

/**
 * Filtra las entradas no disponibles y toma las primeras `max` disponibles en orden.
 * `skipped` cuenta las entradas no disponibles descartadas dentro de lo examinado
 * (todas las no disponibles de la lista).
 */
export function buildPlaylist(entries: unknown[], requestedBy: string, max = MAX_PLAYLIST_TRACKS): ResolvedPlaylist {
  const tracks: Track[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const t = entryToTrack(entry, requestedBy);
    if (t === null) {
      skipped++;
      continue;
    }
    if (tracks.length < max) tracks.push(t);
  }
  return { tracks, skipped };
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

export class Resolver {
  constructor(private readonly run: YtDlpRunner = createYtDlpRunner()) {}

  /** Resuelve la entrada de /play: vídeo, lista o búsqueda (primer resultado). */
  async resolve(input: string, requestedBy: string): Promise<Result<ResolveResult, ResolveError>> {
    const text = input.trim();
    const kind = classifyInput(text);
    switch (kind) {
      case 'invalid_url':
        return err('invalid_link');
      case 'video_url':
        return this.resolveVideo(normalizeUrl(text), requestedBy);
      case 'playlist_url':
        return this.resolvePlaylist(normalizeUrl(text), requestedBy);
      case 'search':
        return this.resolveSearch(text, requestedBy);
    }
  }

  /** Búsqueda para autocompletado: 3 s, lista vacía ante cualquier fallo. */
  async searchSuggestions(query: string, requestedBy = '', limit = AUTOCOMPLETE_LIMIT): Promise<Track[]> {
    const q = query.trim();
    if (q.length === 0) return [];
    try {
      const out = await this.run(
        ['--flat-playlist', '--dump-single-json', '--no-warnings', `ytsearch${limit}:${q}`],
        AUTOCOMPLETE_TIMEOUT_MS,
      );
      if (out.timedOut || out.code !== 0) return [];
      const json = parseJson(out.stdout);
      if (!isRecord(json) || !Array.isArray(json['entries'])) return [];
      return buildPlaylist(json['entries'], requestedBy, limit).tracks;
    } catch {
      return [];
    }
  }

  private async exec(args: string[]): Promise<Result<unknown, ResolveError>> {
    let out: YtDlpOutput;
    try {
      out = await this.run(args, RESOLVE_TIMEOUT_MS);
    } catch {
      return err('invalid_link');
    }
    if (out.timedOut) return err('timeout');
    if (out.code !== 0) return err(mapYtDlpError(out.stderr));
    const json = parseJson(out.stdout);
    if (json === undefined) return err('invalid_link');
    return ok(json);
  }

  private async resolveVideo(url: string, requestedBy: string): Promise<Result<ResolveResult, ResolveError>> {
    const r = await this.exec(['--dump-single-json', '--no-playlist', '--no-warnings', url]);
    if (!r.ok) return r;
    const track = entryToTrack(r.value, requestedBy);
    if (track === null) return err('unavailable:deleted');
    return ok({ kind: 'track', track });
  }

  private async resolveSearch(query: string, requestedBy: string): Promise<Result<ResolveResult, ResolveError>> {
    const r = await this.exec(['--dump-single-json', '--flat-playlist', '--no-warnings', `ytsearch1:${query}`]);
    if (!r.ok) return r;
    const json = r.value;
    const entries = isRecord(json) && Array.isArray(json['entries']) ? json['entries'] : [];
    for (const entry of entries) {
      const track = entryToTrack(entry, requestedBy);
      if (track !== null) return ok({ kind: 'track', track });
    }
    return err('no_results');
  }

  private async resolvePlaylist(url: string, requestedBy: string): Promise<Result<ResolveResult, ResolveError>> {
    const r = await this.exec(['--dump-single-json', '--flat-playlist', '--yes-playlist', '--no-warnings', url]);
    if (!r.ok) return r;
    const json = r.value;
    const entries = isRecord(json) && Array.isArray(json['entries']) ? json['entries'] : [];
    const playlist = buildPlaylist(entries, requestedBy);
    if (playlist.tracks.length === 0) return err('no_results');
    return ok({ kind: 'playlist', ...playlist });
  }
}

function normalizeUrl(text: string): string {
  return /^www\./i.test(text) ? `https://${text}` : text;
}
