import type { Clock, TimerHandle } from './clock.js';

export const RECONNECT_MAX_ATTEMPTS = 3;
export const RECONNECT_WINDOW_MS = 15_000;
export const RECONNECT_RETRY_DELAY_MS = 1_000;

/** Cambio del estado de voz del propio Bot. */
export type BotVoiceChange =
  | { kind: 'none' }
  | { kind: 'moved'; newChannelId: string }
  | { kind: 'disconnected' };

/** Distingue movimiento del Bot (9.7) de desconexión manual (9.8). */
export function classifyBotVoiceChange(
  oldChannelId: string | null,
  newChannelId: string | null,
): BotVoiceChange {
  if (oldChannelId === newChannelId) return { kind: 'none' };
  if (oldChannelId !== null && newChannelId === null) return { kind: 'disconnected' };
  if (newChannelId !== null) return { kind: 'moved', newChannelId };
  return { kind: 'none' };
}

export type ReconnectOutcome = 'resumed' | 'failed' | 'cancelled';

export interface VoiceReconnectDeps {
  clock: Clock;
  /** Intenta reconectar; resuelve true si tuvo éxito. Un rechazo cuenta como fallo. */
  reconnect: () => Promise<boolean>;
  /** Reconexión correcta: reanudar la Pista en la posición de la interrupción. */
  onResume: (positionMs: number) => void;
  /** Reconexión fallida: destruir sesión, avisar al canal de texto y conservar la Cola 600 s. */
  onFail: () => void;
  /** El Bot fue movido: continuar en el nuevo canal conservando Cola y posición. */
  onMoved?: (newChannelId: string) => void;
  /** Desconexión manual: detener, vaciar la Cola y liberar la sesión sin reconectar. */
  onManualDisconnect: () => void;
  maxAttempts?: number;
  windowMs?: number;
  retryDelayMs?: number;
}

/**
 * Política de reconexión de voz (Requisitos 9.4, 9.5, 9.7, 9.8).
 * Lógica pura: el tiempo y la reconexión real se inyectan.
 */
export class VoiceReconnectPolicy {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly retryDelayMs: number;
  private run = 0; // identificador de la ejecución activa; 0 = ninguna
  private nextRun = 1;
  private timers: TimerHandle[] = [];
  private attemptsMade = 0;

  constructor(private readonly deps: VoiceReconnectDeps) {
    this.maxAttempts = deps.maxAttempts ?? RECONNECT_MAX_ATTEMPTS;
    this.windowMs = deps.windowMs ?? RECONNECT_WINDOW_MS;
    this.retryDelayMs = deps.retryDelayMs ?? RECONNECT_RETRY_DELAY_MS;
  }

  get reconnecting(): boolean {
    return this.run !== 0;
  }

  get attempts(): number {
    return this.attemptsMade;
  }

  /** La conexión se interrumpió con la Pista en `positionMs`. */
  handleInterruption(positionMs: number): void {
    if (this.run !== 0) return;
    const id = this.nextRun++;
    this.run = id;
    this.attemptsMade = 0;
    this.timers.push(this.deps.clock.setTimeout(() => this.finish(id, 'failed'), this.windowMs));
    this.attempt(id, positionMs);
  }

  /** Cambio de canal de voz del Bot. */
  handleBotVoiceChange(oldChannelId: string | null, newChannelId: string | null): BotVoiceChange {
    const change = classifyBotVoiceChange(oldChannelId, newChannelId);
    if (change.kind === 'moved') {
      this.deps.onMoved?.(change.newChannelId);
    } else if (change.kind === 'disconnected') {
      this.cancel();
      this.deps.onManualDisconnect();
    }
    return change;
  }

  /** Cancela cualquier reconexión en curso sin invocar callbacks. */
  cancel(): void {
    this.clearTimers();
    this.run = 0;
  }

  private attempt(id: number, positionMs: number): void {
    if (this.run !== id) return;
    this.attemptsMade++;
    let p: Promise<boolean>;
    try {
      p = this.deps.reconnect();
    } catch {
      p = Promise.resolve(false);
    }
    p.catch(() => false).then((success) => {
      if (this.run !== id) return;
      if (success) {
        this.finish(id, 'resumed', positionMs);
      } else if (this.attemptsMade >= this.maxAttempts) {
        this.finish(id, 'failed');
      } else {
        this.timers.push(
          this.deps.clock.setTimeout(() => this.attempt(id, positionMs), this.retryDelayMs),
        );
      }
    });
  }

  private finish(id: number, outcome: 'resumed' | 'failed', positionMs = 0): void {
    if (this.run !== id) return;
    this.clearTimers();
    this.run = 0;
    if (outcome === 'resumed') this.deps.onResume(positionMs);
    else this.deps.onFail();
  }

  private clearTimers(): void {
    for (const t of this.timers) this.deps.clock.clearTimeout(t);
    this.timers = [];
  }
}
