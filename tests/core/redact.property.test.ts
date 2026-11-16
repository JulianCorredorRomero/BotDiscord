import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { redactSecrets, Logger } from '../../src/core/logger.js';

// Feature: discord-music-bot, Property 34: Redacción de secretos
// **Validates: Requirements 10.3**
describe('Property 34: Redacción de secretos', () => {
  const alpha = fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'x', 'T', '1', '-', ' '), minLength: 0, maxLength: 12 });
  const secret = fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'x', 'T', '1'), minLength: 1, maxLength: 8 });
  const secrets = fc.array(secret, { minLength: 1, maxLength: 4 });

  it('la salida no contiene ningún secreto (apariciones repetidas, incrustadas y solapadas)', () => {
    fc.assert(
      fc.property(secrets, fc.array(alpha, { maxLength: 6 }), fc.array(fc.nat(5), { maxLength: 6 }), (ss, pieces, idx) => {
        // Texto con secretos insertados varias veces, pegados a otros textos.
        const parts: string[] = [];
        pieces.forEach((p, i) => {
          parts.push(p, ss[(idx[i] ?? 0) % ss.length]!);
        });
        const text = parts.join('') + ss.join('');
        const out = redactSecrets(text, ss);
        for (const s of ss) expect(out.includes(s)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('secretos que son subcadena de otros no dejan restos', () => {
    fc.assert(
      fc.property(secret, alpha, alpha, fc.integer({ min: 1, max: 4 }), (base, pre, post, n) => {
        const longer = pre + base + post;
        const ss = [base, longer].filter((s) => s.length > 0);
        const text = (longer + '|').repeat(n) + base;
        const out = redactSecrets(text, ss);
        for (const s of ss) expect(out.includes(s)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('eliminar un secreto no puede reconstruir otro (fragmentos unidos)', () => {
    fc.assert(
      fc.property(secret, secret, (a, b) => {
        const out = redactSecrets(a + a + b + b + a, [a + b, a, b]);
        for (const s of [a + b, a, b]) expect(out.includes(s)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('Logger.log y Logger.redact no filtran secretos', () => {
    fc.assert(
      fc.property(secrets, alpha, (ss, desc) => {
        const lines: string[] = [];
        const logger = new Logger(ss, (l) => lines.push(l), () => new Date(0));
        const line = logger.log('error', desc + ss[0] + desc + ss[0], null);
        for (const s of ss) {
          expect(line.includes(s)).toBe(false);
          expect(lines[0]!.includes(s)).toBe(false);
          expect(logger.redact(desc + s).includes(s)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('los secretos vacíos se ignoran y el texto sin secretos no cambia', () => {
    expect(redactSecrets('hola', [''])).toBe('hola');
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('q', 'z', ' '), maxLength: 20 }), (t) => {
        expect(redactSecrets(t, ['abc', 'T1'])).toBe(t);
      }),
      { numRuns: 100 },
    );
  });
});
