export interface Track {
  /** Id de vídeo de YouTube. */
  id: string;
  title: string;
  /** Entero >= 0. */
  durationSec: number;
  url: string;
  thumbnailUrl: string;
  /** userId del solicitante. */
  requestedBy: string;
}

export type LoopMode = 'off' | 'track' | 'queue';

export const LOOP_MODES: readonly LoopMode[] = ['off', 'track', 'queue'];

export interface Playlist {
  /** 1..50 caracteres. */
  name: string;
  creatorId: string;
  guildId: string;
  /** 1..200 pistas, orden preservado. */
  tracks: Track[];
}

export interface GuildSettings {
  guildId: string;
  /** 0..100, por defecto 50. */
  volume: number;
  djRoleId: string | null;
  /** Por defecto 'es'. */
  language: string;
}

export const DEFAULT_VOLUME = 50;
export const DEFAULT_LANGUAGE = 'es';

export const COMMAND_NAMES = [
  'play',
  'pause',
  'resume',
  'skip',
  'stop',
  'nowplaying',
  'queue',
  'loop',
  'shuffle',
  'remove',
  'volume',
  'playlist',
  'dj',
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];
