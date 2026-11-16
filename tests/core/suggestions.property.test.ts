import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { limitSuggestions } from '../../src/core/volume-format.js';

// Feature: discord-music-bot, Property 26: Sugerencias de autocompletado
// **Validates: Requirements 6.4**
describe('Property 26: Sugerencias de autocompletado', () => {
  it('devuelve como máximo 5, conserva el orden, títulos <= 100 caracteres y duración', () => {
    const result = fc.record({
      title: fc.oneof(fc.string({ maxLength: 300 }), fc.fullUnicodeString({ maxLength: 300 })),
      durationSec: fc.integer({ min: 0, max: 100_000 }),
    });
    fc.assert(
      fc.property(fc.array(result, { maxLength: 20 }), (results) => {
        const out = limitSuggestions(results);
        expect(out.length).toBe(Math.min(5, results.length));
        out.forEach((s, i) => {
          expect(Array.from(s.name).length).toBeLessThanOrEqual(100);
          expect(results[i]!.title.startsWith(s.name)).toBe(true);
          expect(s.durationSec).toBe(results[i]!.durationSec);
        });
      }),
      { numRuns: 100 },
    );
  });
});
