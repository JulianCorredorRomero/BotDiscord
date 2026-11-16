import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { FakeClock } from '../../src/core/clock.js';
import { VoiceReconnectPolicy } from '../../src/core/voiceReconnect.js';

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const STEP = 100;
const WINDOW = 15_000;
const RETRY = 1_000;

/** Modelo de referencia: resultado esperado para un patrón dado. */
function expected(results: boolean[], delays: number[]): { outcome: 'resumed' | 'failed'; attempts: number } {
  let t = 0;
  let attempts = 0;
  for (let i = 0; i < 3; i++) {
    if (t >= WINDOW) return { outcome: 'failed', attempts };
    attempts++;
    const end = t + delays[i]!;
    if (end >= WINDOW) return { outcome: 'failed', attempts };
    if (results[i]) return { outcome: 'resumed', attempts };
    t = end + RETRY;
  }
  return { outcome: 'failed', attempts };
}

describe('Reconexión de voz (propiedad)', () => {
  // Feature: discord-music-bot, Property 32: Reconexión de voz
  // **Validates: Requirements 9.4, 9.5**
  it('Property 32: máximo 3 intentos en 15 s, reanuda en la posición o destruye la sesión', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        fc.array(fc.integer({ min: 0, max: 80 }).map((n) => n * STEP), { minLength: 3, maxLength: 3 }),
        fc.integer({ min: 0, max: 36_000_000 }),
        async (results, delays, position) => {
          const clock = new FakeClock();
          let calls = 0;
          const resumes: number[] = [];
          let fails = 0;
          const policy = new VoiceReconnectPolicy({
            clock,
            reconnect: () => {
              const i = calls++;
              return new Promise<boolean>((resolve) => {
                clock.setTimeout(() => resolve(results[i] ?? false), delays[i] ?? 0);
              });
            },
            onResume: (p) => resumes.push(p),
            onFail: () => {
              fails++;
            },
            onManualDisconnect: () => {},
          });

          policy.handleInterruption(position);
          await flush();
          for (let t = 0; t < WINDOW + 8 * 1000; t += STEP) {
            clock.advance(STEP);
            await flush();
          }

          const exp = expected(results, delays);
          expect(calls).toBeLessThanOrEqual(3);
          expect(calls).toBe(exp.attempts);
          expect(resumes.length + fails).toBe(1);
          if (exp.outcome === 'resumed') {
            expect(resumes).toEqual([position]);
            expect(fails).toBe(0);
          } else {
            expect(fails).toBe(1);
            expect(resumes).toEqual([]);
          }
          expect(policy.reconnecting).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
