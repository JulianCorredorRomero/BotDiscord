import type { Readable } from 'node:stream';
import type { PipelineHandle, PipelineRequest } from '../audio/audioPipeline.js';
import type { Store } from '../store/store.js';

/** Eventos que una sesión de voz comunica al reproductor. */
export interface VoiceSessionListener {
  /** La reproducción de la Pista actual terminó de forma natural. */
  onTrackEnd(): void;
  /** El reproductor de audio falló con la Pista actual. */
  onPlayerError(error: unknown): void;
  /** La conexión se interrumpió (candidata a reconexión, Req. 9.4). */
  onInterrupted(): void;
  /** El Bot cambió de canal (movido) o fue desconectado (`newChannelId` null). */
  onBotChannelChange(oldChannelId: string | null, newChannelId: string | null): void;
}

/** Puerto sobre la conexión de voz de un Servidor (@discordjs/voice). */
export interface VoiceSession {
  readonly channelId: string;
  /** Tasa de bits máxima del canal en kbps. */
  readonly channelBitrateKbps: number;
  /** Participantes no-bot en el canal. */
  humanCount(): number;
  setListener(listener: VoiceSessionListener): void;
  /** Reproduce un flujo Ogg/Opus. */
  play(stream: Readable): void;
  pause(): void;
  unpause(): void;
  /** Detiene la salida sin destruir la conexión. */
  stopOutput(): void;
  /** Un intento de reconexión; true si quedó lista. */
  reconnect(): Promise<boolean>;
  destroy(): void;
}

export interface VoicePermissions {
  connect: boolean;
  speak: boolean;
}

/** Puerto para comprobar permisos y unirse a canales de voz de un Servidor. */
export interface VoiceConnector {
  checkPermissions(channelId: string): VoicePermissions;
  /** Se une al canal (≤ 10 s); rechaza si no lo logra. */
  connect(channelId: string): Promise<VoiceSession>;
}

/** Fábrica de pipelines de audio (normalmente un `AudioPipeline`). */
export interface PipelineFactory {
  start(req: PipelineRequest): Promise<PipelineHandle>;
}

export type TrackFailureReason = 'processing' | 'unavailable' | 'age_restricted' | 'download_failed';

/** Avisos al canal de texto; el llamador los localiza y los envía. */
export type PlayerNotice =
  | { type: 'track_failed'; title: string; reason: TrackFailureReason }
  | { type: 'queue_finished' }
  | { type: 'session_destroyed' }
  | { type: 'disconnected'; reason: 'alone' | 'idle' | 'manual' }
  | { type: 'queue_cleared' }
  | { type: 'moved'; channelId: string };

export interface Notifier {
  notify(notice: PlayerNotice): void;
}

export type VolumeStore = Pick<Store, 'getVolume' | 'setVolume'>;
