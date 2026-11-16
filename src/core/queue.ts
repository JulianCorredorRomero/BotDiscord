import { err, ok, type Result } from './result.js';
import type { LoopMode, Track } from './types.js';

export const MAX_QUEUE_SIZE = 500;

export interface AddResult {
  added: number;
  rejected: number;
  /** Posición (base 1) de la primera pista agregada: n + 1, con n pendientes previas. */
  firstPosition: number;
}

export class Queue {
  readonly maxSize = MAX_QUEUE_SIZE;
  current: Track | null = null;
  pending: Track[] = [];

  /** Agrega al final las primeras pistas que caben; rechaza el resto. */
  add(tracks: Track[]): AddResult {
    const n = this.pending.length;
    const room = Math.max(0, this.maxSize - n);
    const accepted = tracks.slice(0, room);
    this.pending.push(...accepted);
    return {
      added: accepted.length,
      rejected: tracks.length - accepted.length,
      firstPosition: n + 1,
    };
  }

  /** Quita la pista pendiente en la posición `position` (base 1). */
  remove(position: number): Result<Track, 'out_of_range'> {
    if (!Number.isInteger(position) || position < 1 || position > this.pending.length) {
      return err('out_of_range');
    }
    const [removed] = this.pending.splice(position - 1, 1);
    return ok(removed as Track);
  }

  /** Fisher-Yates sobre las pendientes; no toca la pista actual. */
  shuffle(rng: () => number): void {
    const a = this.pending;
    for (let i = a.length - 1; i > 0; i--) {
      let j = Math.floor(rng() * (i + 1));
      if (!(j >= 0)) j = 0;
      if (j > i) j = i;
      [a[i], a[j]] = [a[j] as Track, a[i] as Track];
    }
  }

  /** Avanza a la siguiente pista según el modo de repetición y la devuelve (o null). */
  advance(loop: LoopMode): Track | null {
    if (loop === 'track' && this.current) {
      return this.current;
    }
    if (loop === 'queue' && this.current) {
      this.pending.push(this.current);
    }
    this.current = this.pending.shift() ?? null;
    return this.current;
  }

  /** Salta a la primera pendiente, ignorando la repetición. Null si no hay pendientes. */
  skip(): Track | null {
    return this.advance('off');
  }

  clear(): void {
    this.current = null;
    this.pending = [];
  }
}
