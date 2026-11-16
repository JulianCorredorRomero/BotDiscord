import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { I18n, es, catalogs, type MessageKey } from '../../src/core/i18n.js';

const keys = Object.keys(es) as MessageKey[];
const keyArb = fc.constantFrom(...keys);
const langArb = fc.oneof(
  fc.constantFrom('es', 'en'),
  fc.string({ maxLength: 8 }),
  fc.constant(null),
  fc.constant(undefined),
);

describe('Catálogo de idioma', () => {
  // Feature: discord-music-bot, Property 27: Catálogo de idioma
  // **Validates: Requirements 6.5**
  it('Property 27: usa el catálogo del idioma si existe y, si no, el español', () => {
    const i18n = new I18n();
    const params = { seconds: 7, position: 3, volume: 42 };
    const render = (s: string) => s.replace(/\{(\w+)\}/g, (m, n: string) => (n in params ? String((params as any)[n]) : m));

    fc.assert(
      fc.property(keyArb, langArb, (key, lang) => {
        const out = i18n.t(key, lang, params);
        const own = lang && Object.prototype.hasOwnProperty.call(catalogs, lang) ? catalogs[lang]?.[key] : undefined;
        expect(out).toBe(render(own ?? es[key]));
      }),
      { numRuns: 100 },
    );
  });

  it('Property 27: todas las claves existen en español y el fallback cubre claves ausentes', () => {
    fc.assert(
      fc.property(keyArb, fc.string({ minLength: 1, maxLength: 6 }), (key, lang) => {
        expect(typeof es[key]).toBe('string');
        expect(es[key].length).toBeGreaterThan(0);
        const partial = new I18n({ es, [lang === 'es' ? 'xx' : lang]: {} });
        expect(partial.t(key, lang === 'es' ? 'xx' : lang)).toBe(partial.t(key, 'es'));
      }),
      { numRuns: 100 },
    );
  });
});
