import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SqliteStore } from '../../src/store/store.js';
import { VolumeService } from '../../src/services/volumeService.js';

const GUILD = 'g1';

function setup(initial?: number) {
  const store = new SqliteStore(':memory:');
  if (initial !== undefined) store.setVolume(GUILD, initial);
  const applied: Array<{ volume: number; previous: number }> = [];
  const service = new VolumeService(store, (_g, volume, previous) => applied.push({ volume, previous }));
  return { store, service, applied };
}

const invalidArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: -1_000_000, max: -1 }),
  fc.integer({ min: 101, max: 1_000_000 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isInteger(d)),
  fc.constantFrom(NaN, Infinity, -Infinity),
  fc.integer({ min: -1000, max: -1 }).map(String),
  fc.integer({ min: 101, max: 100000 }).map(String),
  fc.string().filter((s) => !/^\s*-?\d+\s*$/.test(s)),
  fc.constantFrom(null, undefined, true, {}, []),
);

describe('Feature: discord-music-bot, Property 11: Aplicación y consulta de Volumen', () => {
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
  it('todo entero 0..100 se aplica, se guarda, se confirma y get lo devuelve', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (initial, v) => {
        const { store, service, applied } = setup(initial);
        try {
          expect(service.set(GUILD, v)).toEqual({ status: 'applied', volume: v });
          expect(applied).toEqual([{ volume: v, previous: initial }]);
          expect(store.getVolume(GUILD)).toBe(v);
          expect(service.get(GUILD)).toBe(v);
        } finally {
          store.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
  it('todo valor que no es entero 0..100 no cambia el volumen y indica el rango 0..100', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), invalidArb, (initial, raw) => {
        const { store, service, applied } = setup(initial);
        try {
          expect(service.set(GUILD, raw)).toEqual({ status: 'invalid', min: 0, max: 100 });
          expect(applied).toEqual([]);
          expect(store.getVolume(GUILD)).toBe(initial);
          expect(service.get(GUILD)).toBe(initial);
        } finally {
          store.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.2**
  it('get devuelve 50 por defecto', () => {
    const { store, service } = setup();
    expect(service.get(GUILD)).toBe(50);
    store.close();
  });
});
