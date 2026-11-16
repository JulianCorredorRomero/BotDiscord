import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canExecute, RESTRICTED, type MemberInfo } from '../../src/core/permissions.js';
import { COMMAND_NAMES } from '../../src/core/types.js';

const memberArb = fc.record({
  roleIds: fc.array(fc.constantFrom('r1', 'r2', 'dj', 'r3'), { maxLength: 4 }),
  isAdmin: fc.boolean(),
  inBotVoiceChannel: fc.boolean(),
});
const djArb = fc.option(fc.constantFrom('dj', 'r1', 'other'), { nil: null });

describe('permissions property', () => {
  // Feature: discord-music-bot, Property 28: Decisión de permisos
  // **Validates: Requirements 6.3, 8.1, 8.2, 8.6**
  it('Property 28: canExecute permite si y solo si se cumple (a) o (b), sin mutar entradas', () => {
    fc.assert(
      fc.property(fc.constantFrom(...COMMAND_NAMES), memberArb, djArb, (cmd, member: MemberInfo, dj) => {
        const snapshot = JSON.stringify(member);
        const d = canExecute(cmd, member, dj);
        const expected =
          dj !== null
            ? !RESTRICTED.has(cmd) || member.roleIds.includes(dj) || member.isAdmin
            : member.inBotVoiceChannel;
        expect(d.allowed).toBe(expected);
        if (!d.allowed) {
          expect(d.reason).toBe(dj !== null ? 'requires_dj' : 'not_in_voice_channel');
        }
        // Idempotente / determinista (botón == comando equivalente) y sin efectos
        expect(canExecute(cmd, member, dj)).toEqual(d);
        expect(JSON.stringify(member)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});
