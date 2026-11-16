/**
 * Máquina de estados pura para desconexión automática y retención de Cola.
 * Req. 9.1, 9.2, 9.3, 9.5, 9.6.
 *
 * Los plazos se evalúan en cada evento con la marca de tiempo `now` (ms);
 * el llamador debe enviar eventos `tick` periódicos (o programar uno en
 * `nextDeadline()`).
 */

export const ALONE_TIMEOUT_MS = 300_000;
export const IDLE_TIMEOUT_MS = 300_000;
export const QUEUE_RETENTION_MS = 600_000;

export type VoiceEvent =
  | { type: 'tick' }
  /** Número de participantes no-bot en el canal de voz tras un cambio. */
  | { type: 'participants_changed'; humanCount: number }
  /** Cola vacía y sin reproducción en curso (true) o con actividad (false). */
  | { type: 'idle_changed'; idle: boolean }
  /** Se añadió una Pista a la Cola. */
  | { type: 'track_added' }
  /** La sesión de voz fue destruida (p. ej. reconexión fallida o desconexión por plazo). */
  | { type: 'session_destroyed' }
  /** Un Usuario reanudó la reproducción tras la destrucción de la sesión. */
  | { type: 'playback_resumed' };

export type Action =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'disconnect'; reason: 'alone' | 'idle' }
  | { type: 'clear_queue' };

export class IdleTimerStateMachine {
  private aloneSince: number | null = null;
  private idleSince: number | null = null;
  private retentionSince: number | null = null;
  private paused = false;

  onEvent(e: VoiceEvent, now: number): Action[] {
    const actions: Action[] = [];

    switch (e.type) {
      case 'participants_changed':
        if (e.humanCount <= 0) {
          if (this.aloneSince === null && this.retentionSince === null) {
            this.aloneSince = now;
            this.paused = true;
            actions.push({ type: 'pause' });
          }
        } else if (this.aloneSince !== null) {
          this.aloneSince = null;
          if (this.paused) {
            this.paused = false;
            actions.push({ type: 'resume' });
          }
        }
        break;
      case 'idle_changed':
        if (e.idle) {
          if (this.idleSince === null && this.retentionSince === null) this.idleSince = now;
        } else {
          this.idleSince = null;
        }
        break;
      case 'track_added':
        this.idleSince = null;
        break;
      case 'session_destroyed':
        this.aloneSince = null;
        this.idleSince = null;
        this.paused = false;
        this.retentionSince = now;
        break;
      case 'playback_resumed':
        this.retentionSince = null;
        break;
      case 'tick':
        break;
    }

    this.expire(now, actions);
    return actions;
  }

  /** Próximo instante (ms) en que vence algún plazo, o null si no hay ninguno. */
  nextDeadline(): number | null {
    const c: number[] = [];
    if (this.aloneSince !== null) c.push(this.aloneSince + ALONE_TIMEOUT_MS);
    if (this.idleSince !== null) c.push(this.idleSince + IDLE_TIMEOUT_MS);
    if (this.retentionSince !== null) c.push(this.retentionSince + QUEUE_RETENTION_MS);
    return c.length ? Math.min(...c) : null;
  }

  private expire(now: number, actions: Action[]): void {
    if (this.aloneSince !== null && now - this.aloneSince >= ALONE_TIMEOUT_MS) {
      actions.push({ type: 'disconnect', reason: 'alone' });
      this.aloneSince = null;
      this.idleSince = null;
      this.paused = false;
    } else if (this.idleSince !== null && now - this.idleSince >= IDLE_TIMEOUT_MS) {
      actions.push({ type: 'disconnect', reason: 'idle' });
      this.idleSince = null;
      this.aloneSince = null;
    }
    if (this.retentionSince !== null && now - this.retentionSince >= QUEUE_RETENTION_MS) {
      actions.push({ type: 'clear_queue' });
      this.retentionSince = null;
    }
  }
}
