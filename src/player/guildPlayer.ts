import type { PipelineHandle } from '../audio/audioPipeline.js';
import type { Clock, TimerHandle } from '../core/clock.js';
import { IdleTimerStateMachine, type Action, type VoiceEvent } from '../core/idleTimer.js';
import { Queue, type AddResult } from '../core/queue.js';
import { err, ok, type Result } from '../core/result.js';
import { LOOP_MODES, type LoopMode, type Track } from '../core/types.js';
import { VoiceReconnectPolicy } from '../core/voiceReconnect.js';
import { clampVolume, parseVolumeArg, stepVolume } from '../core/volume-format.js';
import type {
  Notifier,
  PipelineFactory,
  TrackFailureReason,
  VoiceConnector,
  VoiceSession,
  VolumeStore,
} from './ports.js';

export type PlayerState = 'inactivo' | 'reproduciendo' | 'pausado' | 'reconectando' | 'sesion_destruida';

/** Errores comunes de comprobación de canal y estado. */
export type PlayerError =
  | { reason: 'not_in_voice' }
  | { reason: 'different_channel'; channelId: string }
  | { reason: 'missing_permission'; permission: 'Connect' | 'Speak' }
  | { reason: 'nothing_playing' }
  | { reason: 'connect_failed' };

export interface EnqueueOutcome extends AddResult {
  /** True si la primera Pista empezó a reproducirse (no quedó en espera). */
  startedPlayback: boolean;
  /** Posición en la Cola de la primera Pista añadida; 0 si empezó a sonar. */
  position: number;
}

export interface NowPlayingInfo {
  track: Track;
  positionSec: number;
  state: PlayerState;
  loop: LoopMode;
  volume: number;
}

export type VolumeError = PlayerError | { reason: 'invalid_volume'; min: 0; max: 100 };
export type LoopError = PlayerError | { reason: 'invalid_loop_mode'; valid: readonly LoopMode[] };

export interface VolumeOutcome {
  volume: number;
  /** False si el Almacén no pudo guardar el valor (Req. 3.6); el volumen sí se aplicó. */
  saved: boolean;
}

export interface GuildPlayerDeps {
  guildId: string;
  clock: Clock;
  connector: VoiceConnector;
  pipelines: PipelineFactory;
  notifier: Notifier;
  store: VolumeStore;
  /** Se invoca cuando la Cola se elimina y el reproductor ya no tiene nada que conservar. */
  onReleased?: () => void;
}

/** Clasifica un error de audio en un motivo mostrable (Req. 5.8, 5.9, 7.2, 7.3, 7.5). */
export function classifyTrackFailure(e: unknown): TrackFailureReason {
  const o = (e ?? {}) as { kind?: unknown; reason?: unknown };
  for (const v of [o.reason, o.kind]) {
    if (v === 'age_restricted') return 'age_restricted';
    if (v === 'unavailable' || v === 'deleted' || v === 'private' || v === 'region') return 'unavailable';
    if (v === 'download_failed') return 'download_failed';
  }
  return 'processing';
}

/**
 * Reproductor de un Servidor. Orquesta Cola, sesión de voz, pipeline de audio,
 * temporizadores de inactividad y reconexión. Toda la E/S entra por puertos inyectados.
 */
export class GuildPlayer {
  readonly queue = new Queue();
  private loopMode: LoopMode = 'off';
  private _state: PlayerState = 'inactivo';
  private volume: number;

  private session: VoiceSession | null = null;
  private handle: PipelineHandle | null = null;
  /** Invalida callbacks de pistas anteriores. */
  private token = 0;

  private posBaseMs = 0;
  private posStartedAt: number | null = null;

  private idle = new IdleTimerStateMachine();
  private idleTimer: TimerHandle | null = null;
  private pausedByIdle = false;
  private stateBeforeReconnect: 'reproduciendo' | 'pausado' = 'reproduciendo';

  private readonly reconnect: VoiceReconnectPolicy;

  constructor(private readonly deps: GuildPlayerDeps) {
    this.volume = deps.store.getVolume(deps.guildId);
    this.reconnect = new VoiceReconnectPolicy({
      clock: deps.clock,
      reconnect: async () => (this.session ? this.session.reconnect() : false),
      onResume: () => this.onReconnected(),
      onFail: () => this.onReconnectFailed(),
      onMoved: (channelId) => this.deps.notifier.notify({ type: 'moved', channelId }),
      onManualDisconnect: () => this.teardown('manual', false),
    });
  }

  // ---------- Consultas ----------

  get state(): PlayerState {
    return this._state;
  }
  get loop(): LoopMode {
    return this.loopMode;
  }
  get currentVolume(): number {
    return this.volume;
  }
  get voiceChannelId(): string | null {
    return this.session?.channelId ?? null;
  }
  get connected(): boolean {
    return this.session !== null;
  }

  positionMs(): number {
    return this.posBaseMs + (this.posStartedAt === null ? 0 : this.deps.clock.now() - this.posStartedAt);
  }

  nowPlaying(): Result<NowPlayingInfo, PlayerError> {
    const track = this.queue.current;
    if (!track || !this.isActive()) return err({ reason: 'nothing_playing' });
    return ok({
      track,
      positionSec: Math.floor(this.positionMs() / 1000),
      state: this._state,
      loop: this.loopMode,
      volume: this.volume,
    });
  }

  // ---------- Comandos ----------

  /** /play: añade Pistas, se une al canal si hace falta e inicia la reproducción. */
  async enqueue(tracks: Track[], userChannelId: string | null): Promise<Result<EnqueueOutcome, PlayerError>> {
    if (!userChannelId) return err({ reason: 'not_in_voice' });
    if (this.session && this.session.channelId !== userChannelId) {
      if (this._state === 'inactivo') {
        this.releaseSession();
      } else {
        return err({ reason: 'different_channel', channelId: this.session.channelId });
      }
    }
    if (!this.session) {
      const perms = this.deps.connector.checkPermissions(userChannelId);
      if (!perms.connect) return err({ reason: 'missing_permission', permission: 'Connect' });
      if (!perms.speak) return err({ reason: 'missing_permission', permission: 'Speak' });
      try {
        this.attachSession(await this.deps.connector.connect(userChannelId));
      } catch {
        return err({ reason: 'connect_failed' });
      }
    }

    const added = this.queue.add(tracks);
    if (added.added > 0) this.feed({ type: 'track_added' });

    let started = false;
    if (!this.queue.current && this.queue.pending.length > 0) {
      this.queue.advance('off');
      started = true;
    } else if (this._state === 'sesion_destruida' && this.queue.current) {
      started = false;
      this.feed({ type: 'playback_resumed' });
      this.feed({ type: 'idle_changed', idle: false });
      await this.startCurrent();
    }
    if (started) {
      this.feed({ type: 'idle_changed', idle: false });
      await this.startCurrent();
    } else if (!this.queue.current) {
      this.feed({ type: 'idle_changed', idle: true });
    }
    return ok({ ...added, startedPlayback: started, position: started ? 0 : added.firstPosition });
  }

  async pause(userChannelId: string | null): Promise<Result<void, PlayerError>> {
    const c = this.checkControl(userChannelId);
    if (!c.ok) return c;
    if (this._state !== 'reproduciendo') return err({ reason: 'nothing_playing' });
    await this.pauseInternal();
    return ok(undefined);
  }

  async resume(userChannelId: string | null): Promise<Result<void, PlayerError>> {
    const c = this.checkControl(userChannelId);
    if (!c.ok) return c;
    if (this._state !== 'pausado') return err({ reason: 'nothing_playing' });
    this.pausedByIdle = false;
    this.resumeInternal();
    return ok(undefined);
  }

  /** /skip: detiene la actual y pasa a la siguiente pendiente (ignora la repetición). */
  async skip(userChannelId: string | null): Promise<Result<{ next: Track | null }, PlayerError>> {
    const c = this.checkControl(userChannelId);
    if (!c.ok) return c;
    if (!this.queue.current || !this.isActive()) return err({ reason: 'nothing_playing' });
    await this.stopOutputWithFade();
    this.queue.skip();
    if (this.queue.current) {
      await this.startCurrent();
    } else {
      this.onQueueExhausted(false);
    }
    return ok({ next: this.queue.current });
  }

  /** /stop: detiene, vacía la Cola y se desconecta. */
  async stop(userChannelId: string | null): Promise<Result<void, PlayerError>> {
    const c = this.checkControl(userChannelId);
    if (!c.ok) return c;
    await this.stopOutputWithFade();
    this.teardown('manual', false);
    return ok(undefined);
  }

  setLoop(userChannelId: string | null, raw: unknown): Result<LoopMode, LoopError> {
    const c = this.checkControl(userChannelId);
    if (!c.ok) return c;
    if (typeof raw !== 'string' || !(LOOP_MODES as readonly string[]).includes(raw)) {
      return err({ reason: 'invalid_loop_mode', valid: LOOP_MODES });
    }
    this.loopMode = raw as LoopMode;
    return ok(this.loopMode);
  }

  /** /volume con valor: lo aplica con rampa y lo guarda. */
  setVolume(userChannelId: string | null, raw: unknown): Result<VolumeOutcome, VolumeError> {
    const c = this.checkControl(userChannelId);
    if (!c.ok) return c;
    const parsed = parseVolumeArg(raw);
    if (!parsed.ok) return err({ reason: 'invalid_volume', min: 0, max: 100 });
    return ok(this.applyVolume(parsed.value));
  }

  /** Botones de volumen: ±10 limitado a 0..100. */
  adjustVolume(userChannelId: string | null, delta: 10 | -10): Result<VolumeOutcome, VolumeError> {
    const c = this.checkControl(userChannelId);
    if (!c.ok) return c;
    return ok(this.applyVolume(stepVolume(this.volume, delta)));
  }

  /** /volume sin valor. */
  getVolume(): number {
    return this.volume;
  }

  // ---------- Eventos externos ----------

  /** Cambio en el número de participantes no-bot del canal (Req. 9.1, 9.2). */
  notifyHumanCount(humanCount: number): void {
    if (this.session) this.feed({ type: 'participants_changed', humanCount });
  }

  /** El Bot cambió de canal o fue desconectado (Req. 9.7, 9.8). */
  notifyBotChannelChange(oldChannelId: string | null, newChannelId: string | null): void {
    this.reconnect.handleBotVoiceChange(oldChannelId, newChannelId);
  }

  /** Libera temporizadores y la conexión sin avisos. */
  dispose(): void {
    this.token++;
    this.reconnect.cancel();
    this.clearIdleTimer();
    this.handle?.destroy();
    this.handle = null;
    this.releaseSession();
    this.queue.clear();
    this._state = 'inactivo';
  }

  // ---------- Internos: comprobaciones ----------

  private isActive(): boolean {
    return this._state === 'reproduciendo' || this._state === 'pausado' || this._state === 'reconectando';
  }

  private checkControl(userChannelId: string | null): Result<void, PlayerError> {
    if (!userChannelId) return err({ reason: 'not_in_voice' });
    if (this.session && this.session.channelId !== userChannelId) {
      return err({ reason: 'different_channel', channelId: this.session.channelId });
    }
    return ok(undefined);
  }

  // ---------- Internos: sesión ----------

  private attachSession(session: VoiceSession): void {
    this.session = session;
    this.volume = this.deps.store.getVolume(this.deps.guildId); // Req. 3.7, 3.8
    session.setListener({
      onTrackEnd: () => this.onTrackEnd(),
      onPlayerError: (e) => void this.onTrackFailed(this.token, e),
      onInterrupted: () => this.onInterrupted(),
      onBotChannelChange: (o, n) => this.notifyBotChannelChange(o, n),
    });
    this.feed({ type: 'participants_changed', humanCount: session.humanCount() });
  }

  private releaseSession(): void {
    const s = this.session;
    this.session = null;
    s?.destroy();
  }

  private teardown(reason: 'alone' | 'idle' | 'manual', notify = true): void {
    this.token++;
    this.reconnect.cancel();
    this.handle?.destroy();
    this.handle = null;
    this.releaseSession();
    this.queue.clear();
    this.freezeClock(true);
    this._state = 'inactivo';
    this.pausedByIdle = false;
    this.idle = new IdleTimerStateMachine();
    this.clearIdleTimer();
    if (notify || reason !== 'manual') this.deps.notifier.notify({ type: 'disconnected', reason });
    this.deps.onReleased?.();
  }

  // ---------- Internos: reproducción ----------

  private applyVolume(v: number): VolumeOutcome {
    const volume = clampVolume(v);
    this.volume = volume;
    this.handle?.setVolume(volume);
    const saved = this.deps.store.setVolume(this.deps.guildId, volume).ok;
    return { volume, saved };
  }

  /** Reproduce `queue.current`; omite Pistas que fallan al arrancar. */
  private async startCurrent(): Promise<void> {
    for (;;) {
      const track = this.queue.current;
      const session = this.session;
      if (!track || !session) {
        if (!track) this.onQueueExhausted(true);
        return;
      }
      const token = ++this.token;
      let handle: PipelineHandle;
      try {
        handle = await this.deps.pipelines.start({
          url: track.url,
          durationSec: track.durationSec,
          volume: this.volume,
          channelMaxKbps: session.channelBitrateKbps,
        });
      } catch (e) {
        if (token !== this.token) return;
        this.deps.notifier.notify({ type: 'track_failed', title: track.title, reason: classifyTrackFailure(e) });
        this.queue.skip();
        continue;
      }
      if (token !== this.token || this.session !== session) {
        handle.destroy();
        return;
      }
      this.handle = handle;
      handle.failed.catch((e: unknown) => this.onTrackFailed(token, e));
      session.play(handle.stream);
      this._state = 'reproduciendo';
      this.posBaseMs = 0;
      this.posStartedAt = this.deps.clock.now();
      this.pausedByIdle = false;
      return;
    }
  }

  private async onTrackFailed(token: number, e: unknown): Promise<void> {
    if (token !== this.token || !this.queue.current) return;
    const track = this.queue.current;
    this.handle?.destroy();
    this.handle = null;
    this.deps.notifier.notify({ type: 'track_failed', title: track.title, reason: classifyTrackFailure(e) });
    this.queue.skip();
    if (this.queue.current) await this.startCurrent();
    else this.onQueueExhausted(true);
  }

  private onTrackEnd(): void {
    if (!this.handle || this._state !== 'reproduciendo') return;
    this.handle.destroy();
    this.handle = null;
    this.queue.advance(this.loopMode);
    if (this.queue.current) void this.startCurrent();
    else this.onQueueExhausted(true);
  }

  /** Cola agotada: se detiene la reproducción pero se mantiene la conexión (Req. 5.9, 7.3). */
  private onQueueExhausted(notify: boolean): void {
    this.token++;
    this.handle?.destroy();
    this.handle = null;
    this.session?.stopOutput();
    this.queue.current = null;
    this._state = 'inactivo';
    this.freezeClock(true);
    if (notify) this.deps.notifier.notify({ type: 'queue_finished' });
    this.feed({ type: 'idle_changed', idle: true });
  }

  private async stopOutputWithFade(): Promise<void> {
    const h = this.handle;
    this.token++;
    this.handle = null;
    if (h) await h.fadeOutAndStop();
    this.session?.stopOutput();
  }

  private async pauseInternal(): Promise<void> {
    if (this._state !== 'reproduciendo') return;
    this.freezeClock(false);
    this._state = 'pausado';
    await this.handle?.pause();
    if (this._state === 'pausado') this.session?.pause();
  }

  private resumeInternal(): void {
    if (this._state !== 'pausado') return;
    this.session?.unpause();
    this.handle?.resume();
    this.posStartedAt = this.deps.clock.now();
    this._state = 'reproduciendo';
  }

  private freezeClock(reset: boolean): void {
    if (this.posStartedAt !== null) this.posBaseMs += this.deps.clock.now() - this.posStartedAt;
    this.posStartedAt = null;
    if (reset) this.posBaseMs = 0;
  }

  // ---------- Internos: reconexión ----------

  private onInterrupted(): void {
    if (!this.session || this.reconnect.reconnecting) return;
    if (this._state !== 'reproduciendo' && this._state !== 'pausado') return;
    this.stateBeforeReconnect = this._state;
    const pos = this.positionMs();
    this.freezeClock(false);
    this.session.pause();
    this._state = 'reconectando';
    this.reconnect.handleInterruption(pos);
  }

  private onReconnected(): void {
    if (this._state !== 'reconectando') return;
    if (this.stateBeforeReconnect === 'reproduciendo') {
      this.session?.unpause();
      this.posStartedAt = this.deps.clock.now();
      this._state = 'reproduciendo';
    } else {
      this._state = 'pausado';
    }
  }

  /** 3 fallos o 15 s: destruir la sesión, avisar y conservar la Cola 600 s (Req. 9.5). */
  private onReconnectFailed(): void {
    this.token++;
    this.handle?.destroy();
    this.handle = null;
    this.releaseSession();
    this.freezeClock(true);
    this._state = 'sesion_destruida';
    this.deps.notifier.notify({ type: 'session_destroyed' });
    this.feed({ type: 'session_destroyed' });
  }

  // ---------- Internos: temporizadores de inactividad ----------

  private feed(event: VoiceEvent): void {
    const actions = this.idle.onEvent(event, this.deps.clock.now());
    this.scheduleTick();
    for (const a of actions) this.apply(a);
  }

  private scheduleTick(): void {
    this.clearIdleTimer();
    const deadline = this.idle.nextDeadline();
    if (deadline === null) return;
    this.idleTimer = this.deps.clock.setTimeout(
      () => {
        this.idleTimer = null;
        this.feed({ type: 'tick' });
      },
      Math.max(0, deadline - this.deps.clock.now()),
    );
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) this.deps.clock.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private apply(a: Action): void {
    switch (a.type) {
      case 'pause':
        if (this._state === 'reproduciendo') {
          this.pausedByIdle = true;
          void this.pauseInternal();
        }
        break;
      case 'resume':
        if (this.pausedByIdle) {
          this.pausedByIdle = false;
          this.resumeInternal();
        }
        break;
      case 'disconnect':
        this.teardown(a.reason);
        break;
      case 'clear_queue':
        this.queue.clear();
        this._state = 'inactivo';
        this.deps.notifier.notify({ type: 'queue_cleared' });
        this.deps.onReleased?.();
        break;
    }
  }
}
