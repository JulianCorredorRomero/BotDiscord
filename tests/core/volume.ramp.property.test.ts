import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { volumeRamp } from '../../src/core/volume-format.js';

// Feature: discord-music-bot, Property 12: Rampa lineal de volumen
// **Validates: Requirements 3.4**
describe('Property 12: Rampa lineal de volumen', () => {
  it('tiene sampleRate*0.3 muestras, empieza en from, termina en to y es lineal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.constantFrom(8000, 16000, 44100, 48000),
        (from, to, sampleRate) => {
          const ramp = volumeRamp(from, to, 300, sampleRate);
          const n = Math.round(sampleRate * 0.3);
          expect(ramp).toHaveLength(n);
          expect(ramp[0]).toBeCloseTo(from / 100, 9);
          expect(ramp[n - 1]).toBeCloseTo(to / 100, 9);
          const step = (to / 100 - from / 100) / (n - 1);
          for (let i = 1; i < n; i++) {
            expect(Math.abs(ramp[i]! - ramp[i - 1]! - step)).toBeLessThan(1e-9);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
