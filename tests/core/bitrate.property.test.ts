import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { selectOpusBitrate, MAX_OPUS_KBPS } from '../../src/core/volume-format.js';

describe('Bitrate selection', () => {
  // Feature: discord-music-bot, Property 22: Selección de tasa de bits
  // **Validates: Requirements 5.6**
  it('Property 22: la tasa Opus es min(96, máximo del canal)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 512 }), (max) => {
        expect(selectOpusBitrate(max)).toBe(Math.min(96, max));
        expect(selectOpusBitrate(max)).toBeLessThanOrEqual(MAX_OPUS_KBPS);
      }),
      { numRuns: 100 },
    );
  });
});
