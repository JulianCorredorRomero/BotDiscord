import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatLogEntry } from '../../src/core/logger.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const word = fc.stringMatching(/^[A-Za-z0-9_ .:-]{1,30}$/).filter((s) => s.trim().length > 0 && !s.includes(' | '));

describe('Log entry format', () => {
  // Feature: discord-music-bot, Property 35: Formato de entradas de registro
  // **Validates: Requirements 10.4, 10.5**
  it('Property 35: la entrada contiene fecha ISO 8601 UTC, tipo, descripción y guildId o "ninguno"', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }),
        word,
        fc.option(word, { nil: undefined }),
        fc.option(fc.stringMatching(/^\d{17,20}$/), { nil: undefined }),
        (at, type, description, guildId) => {
          const line = formatLogEntry({ at, type, description, guildId });
          const parts = line.split(' | ');
          expect(parts[0]).toMatch(ISO);
          expect(new Date(parts[0]!).getTime()).toBe(at.getTime());
          expect(parts[1]).toBe(type);
          expect(parts[2]).toBe(`guildId=${guildId ?? 'ninguno'}`);
          if (description !== undefined) expect(parts[3]).toBe(description);
          else expect(parts).toHaveLength(3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('usa "ninguno" cuando guildId es null', () => {
    const line = formatLogEntry({ at: new Date(0), type: 'error', guildId: null });
    expect(line).toContain('guildId=ninguno');
  });
});
