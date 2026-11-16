import type { Clock, TimerHandle } from '../core/clock.js';
import { validatePlaylistSave } from '../core/playlist.js';
import type { Queue } from '../core/queue.js';
import type { Playlist, Track } from '../core/types.js';
import type { PlaylistSummary, Store, StoreError } from '../store/store.js';

/** Plazo de confirmación de sobrescritura (Req. 4.6). */
export const OVERWRITE_CONFIRM_MS = 30_000;

export interface SaveInput {
  guildId: string;
  userId: string;
  name: string;
  current: Track | null;
  pending: readonly Track[];
  /** Se invoca si el plazo de confirmación expira (la operación queda cancelada). */
  onExpire?: () => void;
}

export type SaveResult =
  | { status: 'saved'; name: string; trackCount: number }
  | { status: 'confirm_required'; name: string; timeoutMs: number }
  | { status: 'empty' | 'too_many_tracks' | 'too_many_playlists' | 'bad_name' }
  | { status: 'store_error'; error: StoreError };

export type ConfirmResult =
  | { status: 'saved'; name: string; trackCount: number }
  | { status: 'cancelled'; reason: 'rejected' | 'expired' | 'none_pending' }
  | { status: 'store_error'; error: StoreError };

export type LoadResult =
  | { status: 'loaded'; name: string; added: number; rejected: number }
  | { status: 'not_found' }
  | { status: 'store_error'; error: StoreError };

export type ListResult =
  | { status: 'ok'; playlists: PlaylistSummary[] }
  | { status: 'empty' };

export type DeleteResult =
  | { status: 'deleted'; name: string }
  | { status: 'not_found' }
  | { status: 'not_creator' }
  | { status: 'store_error'; error: StoreError };

interface PendingSave {
  playlist: Playlist;
  handle: TimerHandle;
}

export class PlaylistService {
  private readonly pending = new Map<string, PendingSave>();
  private readonly expired = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly confirmMs: number = OVERWRITE_CONFIRM_MS,
  ) {}

  private key(guildId: string, userId: string, name: string): string {
    return JSON.stringify([guildId, userId, name]);
  }

  save(input: SaveInput): SaveResult {
    const tracks = [...(input.current ? [input.current] : []), ...input.pending];
    const existing = this.store.listPlaylists(input.guildId, input.userId);
    const decision = validatePlaylistSave({
      name: input.name,
      trackCount: tracks.length,
      existingNames: existing.map((e) => e.name),
      userCount: existing.length,
    });
    const playlist: Playlist = {
      name: input.name,
      creatorId: input.userId,
      guildId: input.guildId,
      tracks,
    };

    if (decision === 'ok') return this.persist(playlist);
    if (decision !== 'confirm_overwrite') return { status: decision };

    const key = this.key(input.guildId, input.userId, input.name);
    const previous = this.pending.get(key);
    if (previous) this.clock.clearTimeout(previous.handle);
    this.expired.delete(key);
    const handle = this.clock.setTimeout(() => {
      if (this.pending.get(key)?.handle !== handle) return;
      this.pending.delete(key);
      this.expired.add(key);
      input.onExpire?.();
    }, this.confirmMs);
    this.pending.set(key, { playlist, handle });
    return { status: 'confirm_required', name: input.name, timeoutMs: this.confirmMs };
  }

  /** Resuelve una confirmación pendiente: acepta (sobrescribe) o rechaza (cancela). */
  confirmSave(guildId: string, userId: string, name: string, accept: boolean): ConfirmResult {
    const key = this.key(guildId, userId, name);
    const p = this.pending.get(key);
    if (!p) {
      const reason: 'expired' | 'none_pending' = this.expired.delete(key) ? 'expired' : 'none_pending';
      return { status: 'cancelled', reason };
    }
    this.clock.clearTimeout(p.handle);
    this.pending.delete(key);
    if (!accept) return { status: 'cancelled', reason: 'rejected' };
    return this.persist(p.playlist);
  }

  hasPendingConfirmation(guildId: string, userId: string, name: string): boolean {
    return this.pending.has(this.key(guildId, userId, name));
  }

  private persist(p: Playlist): { status: 'saved'; name: string; trackCount: number } | { status: 'store_error'; error: StoreError } {
    const r = this.store.savePlaylist(p);
    if (!r.ok) return { status: 'store_error', error: r.error };
    return { status: 'saved', name: p.name, trackCount: p.tracks.length };
  }

  /** Añade las pistas de la lista al final de la Cola (Req. 4.2). */
  load(args: { guildId: string; userId: string; name: string; queue: Queue }): LoadResult {
    const r = this.store.getPlaylist(args.guildId, args.userId, args.name);
    if (!r.ok) return { status: 'store_error', error: r.error };
    if (!r.value) return { status: 'not_found' };
    const res = args.queue.add(r.value.tracks.map((t) => ({ ...t })));
    return { status: 'loaded', name: r.value.name, added: res.added, rejected: res.rejected };
  }

  list(guildId: string, userId: string): ListResult {
    const playlists = this.store.listPlaylists(guildId, userId);
    return playlists.length === 0 ? { status: 'empty' } : { status: 'ok', playlists };
  }

  /** Solo el creador puede eliminar (Req. 4.5, 4.7, 4.9). */
  delete(args: { guildId: string; userId: string; name: string }): DeleteResult {
    const creators = this.store.playlistCreators(args.guildId, args.name);
    if (!creators.includes(args.userId)) {
      return creators.length > 0 ? { status: 'not_creator' } : { status: 'not_found' };
    }
    const r = this.store.deletePlaylist(args.guildId, args.userId, args.name);
    if (!r.ok) return { status: 'store_error', error: r.error };
    return r.value ? { status: 'deleted', name: args.name } : { status: 'not_found' };
  }
}
