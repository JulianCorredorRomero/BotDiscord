import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { stepVolume } from '../../src/core/volume-format.js';

// Feature: discord-music-bot, Property 13: Botones de volumen
// **Validates: Requirements 3.9**
describe('Property 13: Botones de volumen', () => {
  it('subir da min(100, v+10)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (v) => {
        expect(stepVolume(v, 10)).toBe(Math.min(100, v + 10));
      }),
      { numRuns: 100 },
    );
  });

  it('bajar da max(0, v-10)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (v) => {
        expect(stepVolume(v, -10)).toBe(Math.max(0, v - 10));
      }),
      { numRuns: 100 },
    );
  });
});
