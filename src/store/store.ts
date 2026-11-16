import Database from 'better-sqlite3';
import { err, ok, type Result } from '../core/result.js';
import { PlaylistSerializer } from '../core/playlist.js';
import { DEFAULT_LANGUAGE, DEFAULT_VOLUME, type GuildSettings, type Playlist } from '../core/types.js';

/** Error tipado de persistencia (Req. 3.6: el volumen se aplica aunque no se guarde). */
export interface StoreError {
  kind: 'save_failed' | 'corrupt_data';
  message: string;
}

export interface PlaylistSummary {
  name: string;
  trackCount: number;
}

/** Interfaz del Almacén (volumen, Rol_DJ, idioma, listas). */
export interface Store {
  getSettings(guildId: string): GuildSettings;
  getVolume(guildId: string): number;
  setVolume(guildId: string, volume: number): Result<void, StoreError>;
  getDjRole(guildId: string): string | null;
  setDjRole(guildId: string, roleId: string | null): Result<void, StoreError>;
  getLanguage(guildId: string): string;
  setLanguage(guildId: string, language: string): Result<void, StoreError>;
  savePlaylist(p: Playlist): Result<void, StoreError>;
  getPlaylist(guildId: string, creatorId: string, name: string): Result<Playlist | null, StoreError>;
  /** Listas del usuario en el servidor, ordenadas alfabéticamente por nombre. */
  listPlaylists(guildId: string, creatorId: string): PlaylistSummary[];
  /** Devuelve true si existía y se eliminó. */
  deletePlaylist(guildId: string, creatorId: string, name: string): Result<boolean, StoreError>;
  /** Creadores que tienen una lista con ese nombre en el servidor (para validar el borrado). */
  playlistCreators(guildId: string, name: string): string[];
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id   TEXT PRIMARY KEY,
  volume     INTEGER NOT NULL DEFAULT 50 CHECK (volume BETWEEN 0 AND 100),
  dj_role_id TEXT,
  language   TEXT NOT NULL DEFAULT 'es'
);
CREATE TABLE IF NOT EXISTS playlists (
  guild_id   TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  tracks     TEXT NOT NULL,
  PRIMARY KEY (guild_id, creator_id, name)
);
`;

function saveFailed(e: unknown): { ok: false; error: StoreError } {
  return err({ kind: 'save_failed', message: e instanceof Error ? e.message : String(e) });
}

export class SqliteStore implements Store {
  private readonly db: Database.Database;
  private readonly serializer = new PlaylistSerializer();

  /** `path` puede ser ':memory:' o un archivo. */
  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }

  getSettings(guildId: string): GuildSettings {
    const row = this.db
      .prepare('SELECT volume, dj_role_id, language FROM guild_settings WHERE guild_id = ?')
      .get(guildId) as { volume: number; dj_role_id: string | null; language: string } | undefined;
    return {
      guildId,
      volume: row?.volume ?? DEFAULT_VOLUME,
      djRoleId: row?.dj_role_id ?? null,
      language: row?.language ?? DEFAULT_LANGUAGE,
    };
  }

  getVolume(guildId: string): number {
    return this.getSettings(guildId).volume;
  }

  getDjRole(guildId: string): string | null {
    return this.getSettings(guildId).djRoleId;
  }

  getLanguage(guildId: string): string {
    return this.getSettings(guildId).language;
  }

  setVolume(guildId: string, volume: number): Result<void, StoreError> {
    return this.run(
      `INSERT INTO guild_settings (guild_id, volume) VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET volume = excluded.volume`,
      guildId,
      volume,
    );
  }

  setDjRole(guildId: string, roleId: string | null): Result<void, StoreError> {
    return this.run(
      `INSERT INTO guild_settings (guild_id, dj_role_id) VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET dj_role_id = excluded.dj_role_id`,
      guildId,
      roleId,
    );
  }

  setLanguage(guildId: string, language: string): Result<void, StoreError> {
    return this.run(
      `INSERT INTO guild_settings (guild_id, language) VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET language = excluded.language`,
      guildId,
      language,
    );
  }

  savePlaylist(p: Playlist): Result<void, StoreError> {
    return this.run(
      `INSERT INTO playlists (guild_id, creator_id, name, tracks) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, creator_id, name) DO UPDATE SET tracks = excluded.tracks`,
      p.guildId,
      p.creatorId,
      p.name,
      this.serializer.serialize(p),
    );
  }

  getPlaylist(guildId: string, creatorId: string, name: string): Result<Playlist | null, StoreError> {
    const row = this.db
      .prepare('SELECT tracks FROM playlists WHERE guild_id = ? AND creator_id = ? AND name = ?')
      .get(guildId, creatorId, name) as { tracks: string } | undefined;
    if (!row) return ok(null);
    const parsed = this.serializer.deserialize(row.tracks);
    if (!parsed.ok) return err({ kind: 'corrupt_data', message: parsed.error.reason });
    return ok(parsed.value);
  }

  listPlaylists(guildId: string, creatorId: string): PlaylistSummary[] {
    const rows = this.db
      .prepare('SELECT name, tracks FROM playlists WHERE guild_id = ? AND creator_id = ?')
      .all(guildId, creatorId) as Array<{ name: string; tracks: string }>;
    const out: PlaylistSummary[] = [];
    for (const r of rows) {
      const parsed = this.serializer.deserialize(r.tracks);
      if (parsed.ok) out.push({ name: r.name, trackCount: parsed.value.tracks.length });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  deletePlaylist(guildId: string, creatorId: string, name: string): Result<boolean, StoreError> {
    try {
      const info = this.db
        .prepare('DELETE FROM playlists WHERE guild_id = ? AND creator_id = ? AND name = ?')
        .run(guildId, creatorId, name);
      return ok(info.changes > 0);
    } catch (e) {
      return saveFailed(e);
    }
  }

  playlistCreators(guildId: string, name: string): string[] {
    const rows = this.db
      .prepare('SELECT creator_id FROM playlists WHERE guild_id = ? AND name = ?')
      .all(guildId, name) as Array<{ creator_id: string }>;
    return rows.map((r) => r.creator_id);
  }

  close(): void {
    this.db.close();
  }

  private run(sql: string, ...params: unknown[]): Result<void, StoreError> {
    try {
      this.db.prepare(sql).run(...params);
      return ok(undefined);
    } catch (e) {
      return saveFailed(e);
    }
  }
}
