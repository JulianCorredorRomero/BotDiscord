import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Track } from '../../src/core/types.js';
import { formatDuration } from '../../src/core/volume-format.js';
import {
  buildNowPlayingModel,
  NP_BUTTON_IDS,
  type NowPlayingState,
} from '../../src/discord/nowPlayingMessage.js';

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 11 }),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  durationSec: fc.integer({ min: 0, max: 100000 }),
  url: fc.webUrl(),
  thumbnailUrl: fc.webUrl(),
  requestedBy: fc.stringMatching(/^[0-9]{5,20}$/),
});

const stateArb = fc.constantFrom<NowPlayingState>(
  'reproduciendo',
  'pausado',
  'inactivo',
  'reconectando',
  'sesion_destruida',
);
const loopArb = fc.constantFrom('off' as const, 'track' as const, 'queue' as const);

describe('Mensaje_de_Reproducción (propiedad)', () => {
  // Feature: discord-music-bot, Property 25: Mensaje_de_Reproducción
  // **Validates: Requirements 6.1, 6.6, 6.9**
  it('contiene título, duración, solicitante, miniatura y seis botones con etiqueta; al finalizar, botones desactivados', () => {
    fc.assert(
      fc.property(
        trackArb,
        stateArb,
        loopArb,
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        (track, state, loop, volume, finished) => {
          const m = buildNowPlayingModel(track, track.requestedBy, state, loop, volume, finished);
          expect(m.title).toBe(track.title);
          expect(m.duration).toBe(formatDuration(track.durationSec));
          expect(m.requester).toBe(track.requestedBy);
          expect(m.thumbnail).toBe(track.thumbnailUrl);
          expect(m.buttons).toHaveLength(6);
          expect(m.buttons.map((b) => b.id).sort()).toEqual(Object.values(NP_BUTTON_IDS).sort());
          for (const b of m.buttons) expect(b.label.trim().length).toBeGreaterThan(0);

          if (finished) {
            expect(m.finished).toBe(true);
            expect(m.notice).toBeTruthy();
            expect(m.buttons.every((b) => b.disabled)).toBe(true);
          } else {
            expect(m.finished).toBe(false);
            expect(m.buttons.every((b) => !b.disabled)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
