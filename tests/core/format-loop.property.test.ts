import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatNowPlaying,
  loopResponse,
  validateLoopMode,
} from '../../src/core/volume-format.js';
import { LOOP_MODES } from '../../src/core/types.js';

// Feature: discord-music-bot, Property 6: Formato de duración y de /nowplaying
// **Validates: Requirements 2.6**
describe('Property 6: Formato de duración y de /nowplaying', () => {
  it('formatDuration produce mm:ss que se interpreta como la misma duración', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (sec) => {
        const out = formatDuration(sec);
        const match = /^(\d{2,}):(\d{2})$/.exec(out);
        expect(match).not.toBeNull();
        const m = Number(match![1]);
        const s = Number(match![2]);
        expect(s).toBeLessThan(60);
        expect(m * 60 + s).toBe(sec);
      }),
      { numRuns: 100 },
    );
  });

  it('/nowplaying contiene título, duración total, posición y miniatura', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.webUrl(),
        (title, durationSec, positionSec, thumbnailUrl) => {
          const out = formatNowPlaying({ title, durationSec, thumbnailUrl }, positionSec);
          expect(out).toContain(title);
          expect(out).toContain(formatDuration(durationSec));
          expect(out).toContain(formatDuration(positionSec));
          expect(out).toContain(thumbnailUrl);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: discord-music-bot, Property 7: Modo de repetición
// **Validates: Requirements 2.7, 2.8**
describe('Property 7: Modo de repetición', () => {
  it('para todo modo válido se fija ese modo y la confirmación lo menciona', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOOP_MODES), (mode) => {
        const r = loopResponse(mode);
        expect(r.ok).toBe(true);
        expect(r.mode).toBe(mode);
        expect(r.message).toContain(mode);
        expect(validateLoopMode(mode)).toEqual({ ok: true, value: mode });
      }),
      { numRuns: 100 },
    );
  });

  it('para cadenas inválidas no hay modo y la respuesta enumera los modos válidos', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(LOOP_MODES as readonly string[]).includes(s)),
        (raw) => {
          const r = loopResponse(raw);
          expect(r.ok).toBe(false);
          expect(r.mode).toBeUndefined();
          for (const m of LOOP_MODES) expect(r.message).toContain(m);
        },
      ),
      { numRuns: 100 },
    );
  });
});
