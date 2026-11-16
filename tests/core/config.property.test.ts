import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { loadConfig, REQUIRED_ENV } from '../../src/core/config.js';

// Feature: discord-music-bot, Property 33: Carga de configuración
// **Validates: Requirements 10.2**
describe('Property 33: Carga de configuración', () => {
  const value = fc.option(fc.oneof(fc.constant(''), fc.string({ minLength: 1 })), { nil: undefined });

  it('con variables por defecto: válida sii todas presentes y no vacías; el error lista exactamente las ausentes/vacías', () => {
    fc.assert(
      fc.property(
        fc.record({ DISCORD_TOKEN: value, DISCORD_CLIENT_ID: value }),
        fc.dictionary(fc.string({ minLength: 1 }).filter((k) => !(REQUIRED_ENV as readonly string[]).includes(k)), fc.string()),
        (vars, extra) => {
          const env = { ...extra, ...vars };
          const expectedMissing = REQUIRED_ENV.filter((n) => env[n] === undefined || env[n] === '');
          const r = loadConfig(env);
          if (expectedMissing.length === 0) {
            expect(r.ok).toBe(true);
            if (r.ok) {
              expect(r.value.discordToken).toBe(env.DISCORD_TOKEN);
              expect(r.value.clientId).toBe(env.DISCORD_CLIENT_ID);
            }
          } else {
            expect(r.ok).toBe(false);
            if (!r.ok) expect([...r.error.missing].sort()).toEqual([...expectedMissing].sort());
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('con conjunto arbitrario de variables obligatorias: error sii alguna falta, con la lista exacta', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[A-Z_]{1,12}$/), { minLength: 1, maxLength: 6 }),
        fc.array(value, { minLength: 6, maxLength: 6 }),
        (names, vals) => {
          const env: Record<string, string | undefined> = {};
          names.forEach((n, i) => {
            env[n] = vals[i];
          });
          const expectedMissing = names.filter((n) => env[n] === undefined || env[n] === '');
          const r = loadConfig(env, names);
          expect(r.ok).toBe(expectedMissing.length === 0);
          if (!r.ok) expect([...r.error.missing].sort()).toEqual([...expectedMissing].sort());
        },
      ),
      { numRuns: 100 },
    );
  });
});
