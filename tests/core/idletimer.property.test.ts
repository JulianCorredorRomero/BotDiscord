import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  IdleTimerStateMachine,
  ALONE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  QUEUE_RETENTION_MS,
  type Action,
  type VoiceEvent,
} from '../../src/core/idleTimer.js';

/** Modelo de referencia basado en plazos absolutos. */
class RefModel {
  aloneAt: number | null = null;
  idleAt: number | null = null;
  retAt: number | null = null;

  step(e: VoiceEvent, now: number): Action[] {
    const out: Action[] = [];
    if (e.type === 'participants_changed') {
      if (e.humanCount <= 0 && this.aloneAt === null && this.retAt === null) {
        this.aloneAt = now;
        out.push({ type: 'pause' });
      } else if (e.humanCount > 0 && this.aloneAt !== null) {
        this.aloneAt = null;
        out.push({ type: 'resume' });
      }
    } else if (e.type === 'idle_changed') {
      if (e.idle) {
        if (this.idleAt === null && this.retAt === null) this.idleAt = now;
      } else this.idleAt = null;
    } else if (e.type === 'track_added') {
      this.idleAt = null;
    } else if (e.type === 'session_destroyed') {
      this.aloneAt = null;
      this.idleAt = null;
      this.retAt = now;
    } else if (e.type === 'playback_resumed') {
      this.retAt = null;
    }
    if (this.aloneAt !== null && now >= this.aloneAt + ALONE_TIMEOUT_MS) {
      out.push({ type: 'disconnect', reason: 'alone' });
      this.aloneAt = null;
      this.idleAt = null;
    } else if (this.idleAt !== null && now >= this.idleAt + IDLE_TIMEOUT_MS) {
      out.push({ type: 'disconnect', reason: 'idle' });
      this.idleAt = null;
      this.aloneAt = null;
    }
    if (this.retAt !== null && now >= this.retAt + QUEUE_RETENTION_MS) {
      out.push({ type: 'clear_queue' });
      this.retAt = null;
    }
    return out;
  }
}

const eventArb: fc.Arbitrary<VoiceEvent> = fc.oneof(
  fc.constant<VoiceEvent>({ type: 'tick' }),
  fc.integer({ min: 0, max: 3 }).map((humanCount): VoiceEvent => ({ type: 'participants_changed', humanCount })),
  fc.boolean().map((idle): VoiceEvent => ({ type: 'idle_changed', idle })),
  fc.constant<VoiceEvent>({ type: 'track_added' }),
  fc.constant<VoiceEvent>({ type: 'session_destroyed' }),
  fc.constant<VoiceEvent>({ type: 'playback_resumed' }),
);

const stepArb = fc.record({
  dt: fc.oneof(
    fc.integer({ min: 0, max: 1_000 }),
    fc.integer({ min: 0, max: 400_000 }),
    fc.constantFrom(ALONE_TIMEOUT_MS - 1, ALONE_TIMEOUT_MS, QUEUE_RETENTION_MS - 1, QUEUE_RETENTION_MS),
  ),
  event: eventArb,
});

describe('Idle timer state machine', () => {
  // Feature: discord-music-bot, Property 31: Máquina de desconexión y retención de Cola
  // **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6**
  it('Property 31: coincide con el modelo de referencia para toda secuencia de eventos', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        const sm = new IdleTimerStateMachine();
        const ref = new RefModel();
        let now = 0;
        for (const s of steps) {
          now += s.dt;
          expect(sm.onEvent(s.event, now)).toEqual(ref.step(s.event, now));
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 31: Máquina de desconexión y retención de Cola
  // **Validates: Requirements 9.1, 9.2**
  it('Property 31: solo en el canal pausa y desconecta a los 300 s; si alguien se une antes, reanuda', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: ALONE_TIMEOUT_MS - 1 }),
        (t0, joinAfter) => {
          const a = new IdleTimerStateMachine();
          expect(a.onEvent({ type: 'participants_changed', humanCount: 0 }, t0)).toEqual([{ type: 'pause' }]);
          expect(a.onEvent({ type: 'tick' }, t0 + ALONE_TIMEOUT_MS - 1)).toEqual([]);
          expect(a.onEvent({ type: 'tick' }, t0 + ALONE_TIMEOUT_MS)).toEqual([{ type: 'disconnect', reason: 'alone' }]);

          const b = new IdleTimerStateMachine();
          b.onEvent({ type: 'participants_changed', humanCount: 0 }, t0);
          expect(b.onEvent({ type: 'participants_changed', humanCount: 1 }, t0 + joinAfter)).toEqual([{ type: 'resume' }]);
          expect(b.onEvent({ type: 'tick' }, t0 + ALONE_TIMEOUT_MS + 10)).toEqual([]);
          expect(b.nextDeadline()).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 31: Máquina de desconexión y retención de Cola
  // **Validates: Requirements 9.3, 9.5**
  it('Property 31: inactividad desconecta a los 300 s y añadir una pista cancela el temporizador', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: IDLE_TIMEOUT_MS - 1 }),
        (t0, addAfter) => {
          const a = new IdleTimerStateMachine();
          a.onEvent({ type: 'idle_changed', idle: true }, t0);
          expect(a.onEvent({ type: 'tick' }, t0 + IDLE_TIMEOUT_MS - 1)).toEqual([]);
          expect(a.onEvent({ type: 'tick' }, t0 + IDLE_TIMEOUT_MS)).toEqual([{ type: 'disconnect', reason: 'idle' }]);

          const b = new IdleTimerStateMachine();
          b.onEvent({ type: 'idle_changed', idle: true }, t0);
          b.onEvent({ type: 'track_added' }, t0 + addAfter);
          expect(b.onEvent({ type: 'tick' }, t0 + IDLE_TIMEOUT_MS + 10)).toEqual([]);
          expect(b.nextDeadline()).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: discord-music-bot, Property 31: Máquina de desconexión y retención de Cola
  // **Validates: Requirements 9.6**
  it('Property 31: tras destruir la sesión la Cola se conserva 600 s y luego se elimina', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: QUEUE_RETENTION_MS - 1 }),
        (t0, resumeAfter) => {
          const a = new IdleTimerStateMachine();
          a.onEvent({ type: 'session_destroyed' }, t0);
          expect(a.onEvent({ type: 'tick' }, t0 + QUEUE_RETENTION_MS - 1)).toEqual([]);
          expect(a.onEvent({ type: 'tick' }, t0 + QUEUE_RETENTION_MS)).toEqual([{ type: 'clear_queue' }]);
          expect(a.onEvent({ type: 'tick' }, t0 + QUEUE_RETENTION_MS + 1)).toEqual([]);

          const b = new IdleTimerStateMachine();
          b.onEvent({ type: 'session_destroyed' }, t0);
          b.onEvent({ type: 'playback_resumed' }, t0 + resumeAfter);
          expect(b.onEvent({ type: 'tick' }, t0 + QUEUE_RETENTION_MS + 1)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
