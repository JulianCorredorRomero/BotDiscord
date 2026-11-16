import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { FakeClock } from '../../src/core/clock.js';
import { withDownloadRetries } from '../../src/audio/retry.js';

const tick = () => new Promise<void>((r) => setImmediate(r));

// Feature: discord-music-bot, Property 24: Reintentos de descarga
describe('Property 24: Reintentos de descarga', () => {
  it('con k fallos consecutivos reproduce si k <= 3 (reintentos cada 2 s) y falla con download_failed si k > 3', async () => {
    // **Validates: Requirements 7.5**
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 10 }), async (k) => {
        const clock = new FakeClock(1000);
        const callTimes: number[] = [];
        const p = withDownloadRetries(async () => {
          callTimes.push(clock.now());
          if (callTimes.length <= k) throw new Error('fallo');
          return 'pista';
        }, clock);

        let done = false;
        void p.then(() => {
          done = true;
        });
        for (let i = 0; i < 5 && !done; i++) {
          await tick();
          clock.advance(2000);
        }
        const r = await p;

        if (k <= 3) {
          expect(r.ok).toBe(true);
          expect(callTimes.length).toBe(k + 1);
        } else {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.kind).toBe('download_failed');
          expect(callTimes.length).toBe(4);
        }
        callTimes.forEach((t, i) => expect(t - callTimes[0]!).toBe(i * 2000));
      }),
      { numRuns: 100 },
    );
  });
});
