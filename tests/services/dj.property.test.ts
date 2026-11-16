import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DjService } from '../../src/services/djService.js';
import { SqliteStore } from '../../src/store/store.js';

type Op =
  | { kind: 'set'; roleId: string; isAdmin: boolean }
  | { kind: 'clear'; isAdmin: boolean };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('set' as const),
    roleId: fc.stringMatching(/^[0-9]{5,20}$/),
    isAdmin: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('clear' as const), isAdmin: fc.boolean() }),
);

describe('DjService properties', () => {
  // Feature: discord-music-bot, Property 29: Configuración del Rol_DJ
  // **Validates: Requirements 8.3, 8.4, 8.5**
  it('admin set/clear leave last set or null; non-admin ops never change the role', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        const store = new SqliteStore(':memory:');
        try {
          const svc = new DjService(store);
          const guildId = 'g1';
          let expected: string | null = null;
          expect(svc.get(guildId)).toBeNull();
          for (const op of ops) {
            const before = svc.get(guildId);
            if (op.kind === 'set') {
              const r = svc.set({ guildId, roleId: op.roleId, isAdmin: op.isAdmin });
              if (op.isAdmin) expected = op.roleId;
              else expect(r.status).toBe('forbidden');
            } else {
              const r = svc.clear({ guildId, isAdmin: op.isAdmin });
              if (op.isAdmin) expected = null;
              else expect(r.status).toBe('forbidden');
            }
            if (!op.isAdmin) expect(svc.get(guildId)).toBe(before);
            expect(svc.get(guildId)).toBe(expected);
          }
        } finally {
          store.close?.();
        }
      }),
      { numRuns: 100 },
    );
  });
});
