// Utilidades puras de volumen, formato, paginación, sugerencias, tasa de bits y validaciones de comandos.

export type PureResult<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface TrackLike {
  title: string;
  durationSec: number;
  thumbnailUrl: string;
}

import { LOOP_MODES } from './types.js';
import type { LoopMode as LoopModeValue } from './types.js';

// ---------- Volumen ----------

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 0 : v > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, v));
}

export function stepVolume(v: number, delta: 10 | -10): number {
  return clampVolume(v + delta);
}

/** Acepta solo enteros entre 0 y 100 (números o cadenas de dígitos). */
export function parseVolumeArg(raw: unknown): PureResult<number, 'invalid'> {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) {
    n = Number(raw.trim());
  } else {
    return { ok: false, error: 'invalid' };
  }
  if (!Number.isInteger(n) || n < 0 || n > 100) return { ok: false, error: 'invalid' };
  return { ok: true, value: n };
}

/**
 * Rampa lineal de ganancia (0..1 = volumen/100) de `sampleRate * durationMs / 1000` muestras.
 * La primera muestra es el nivel de `from` y la última el de `to`.
 */
export function volumeRamp(
  from: number,
  to: number,
  durationMs: number,
  sampleRate: number,
): number[] {
  const n = Math.round((sampleRate * durationMs) / 1000);
  if (n <= 0) return [];
  const a = clampVolume(from) / 100;
  const b = clampVolume(to) / 100;
  if (n === 1) return [b];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1);
  return out;
}

// ---------- Formato y paginación ----------

/** Formatea segundos enteros no negativos como mm:ss (los minutos pueden superar 59). */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface QueuePage<T> {
  items: Array<{ position: number; track: T }>;
  page: number;
  totalPages: number;
}

export function paginateQueue<T>(q: readonly T[], page: number, pageSize = 10): QueuePage<T> {
  const totalPages = Math.max(1, Math.ceil(q.length / pageSize));
  const p = Math.min(totalPages, Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1)));
  const start = (p - 1) * pageSize;
  const items = q.slice(start, start + pageSize).map((track, i) => ({
    position: start + i + 1,
    track,
  }));
  return { items, page: p, totalPages };
}

export function formatQueuePage(page: QueuePage<TrackLike>): string {
  const lines = page.items.map(
    ({ position, track }) => `${position}. ${track.title} (${formatDuration(track.durationSec)})`,
  );
  lines.push(`Página ${page.page}/${page.totalPages}`);
  return lines.join('\n');
}

// ---------- Autocompletado ----------

export function truncateSuggestion(title: string, max = 100): string {
  const chars = Array.from(title);
  return chars.length <= max ? title : chars.slice(0, max).join('');
}

export interface Suggestion {
  name: string;
  durationSec: number;
}

export const MAX_SUGGESTIONS = 5;

export function limitSuggestions<T extends { title: string; durationSec: number }>(
  results: readonly T[],
  max = MAX_SUGGESTIONS,
): Suggestion[] {
  return results.slice(0, max).map((r) => ({
    name: truncateSuggestion(r.title),
    durationSec: r.durationSec,
  }));
}

// ---------- Audio ----------

export const MAX_OPUS_KBPS = 96;

export function selectOpusBitrate(channelMaxKbps: number): number {
  return Math.min(MAX_OPUS_KBPS, channelMaxKbps);
}

// ---------- /loop y /nowplaying ----------

export function validateLoopMode(raw: unknown): PureResult<LoopModeValue, { valid: readonly LoopModeValue[] }> {
  if (typeof raw === 'string' && (LOOP_MODES as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as LoopModeValue };
  }
  return { ok: false, error: { valid: LOOP_MODES } };
}

export function loopResponse(raw: unknown): { ok: boolean; mode?: LoopModeValue; message: string } {
  const r = validateLoopMode(raw);
  if (r.ok) return { ok: true, mode: r.value, message: `Modo de repetición: ${r.value}` };
  return { ok: false, message: `Modo no válido. Modos válidos: ${LOOP_MODES.join(', ')}` };
}

export function formatNowPlaying(track: TrackLike, positionSec: number): string {
  return [
    track.title,
    `${formatDuration(positionSec)} / ${formatDuration(track.durationSec)}`,
    track.thumbnailUrl,
  ].join('\n');
}
