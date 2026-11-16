import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePlaylistSave } from '../../src/core/playlist.js';

// Feature: discord-music-bot, Property 17: Validación de guardado
// **Validates: Requirements 4.6, 4.8, 4.10, 4.11**
describe('Property 17: Validación de guardado', () => {
  it('devuelve la decisión según el orden de reglas', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ minLength: 0, maxLength: 80 }),
          fc.string({ minLength: 1, maxLength: 50 }),
        ),
        fc.integer({ min: -2, max: 250 }),
        fc.array(fc.string({ maxLength: 60 }), { maxLength: 6 }),
        fc.integer({ min: 0, max: 40 }),
        fc.boolean(),
        (rawName, trackCount, others, userCount, includeName) => {
          const existingNames = includeName ? [...others, rawName] : others.filter((n) => n !== rawName);
          const len = Array.from(rawName).length;
          let expected: string;
          if (len < 1 || len > 50) expected = 'bad_name';
          else if (trackCount < 1) expected = 'empty';
          else if (trackCount > 200) expected = 'too_many_tracks';
          else if (existingNames.includes(rawName)) expected = 'confirm_overwrite';
          else if (userCount >= 25) expected = 'too_many_playlists';
          else expected = 'ok';
          expect(
            validatePlaylistSave({ name: rawName, trackCount, existingNames, userCount }),
          ).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
