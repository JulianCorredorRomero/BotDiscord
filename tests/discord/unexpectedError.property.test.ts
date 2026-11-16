import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import { I18n } from '../../src/core/i18n.js';
import { Logger } from '../../src/core/logger.js';
import { RateLimiter } from '../../src/core/rateLimiter.js';
import { Guard, type InteractionContext } from '../../src/discord/guard.js';
import { InteractionRouter } from '../../src/discord/router.js';

function makeCtx(over: Partial<InteractionContext>): { ctx: InteractionContext; replies: string[] } {
  const replies: string[] = [];
  const ctx: InteractionContext = {
    userId: 'u1',
    guildId: 'g1',
    commandName: 'play',
    subcommand: null,
    optionNames: [],
    member: { roleIds: [], isAdmin: true, voiceChannelId: 'vc1' },
    async reply(content) {
      replies.push(content);
    },
    async deferReply() {},
    async editReply(content) {
      replies.push(content);
    },
    async followUp(content) {
      replies.push(content);
    },
    ...over,
  };
  return { ctx, replies };
}

describe('Propiedad 36: errores no previstos', () => {
  // Feature: discord-music-bot, Property 36: Respuesta a errores no previstos
  // **Validates: Requirements 7.8**
  it('responde con el mensaje genérico, registra comando/usuario/servidor y sigue procesando', async () => {
    const i18n = new I18n();
    const generic = i18n.t('error.generic', 'es');
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('play', 'skip', 'pause', 'queue'),
        fc.stringMatching(/^[0-9]{5,18}$/),
        fc.stringMatching(/^[0-9]{5,18}$/),
        fc.stringMatching(/^[a-f0-9]{12,24}$/),
        fc.boolean(),
        fc.boolean(),
        async (commandName, userId, guildId, token, withSecret, slow) => {
          const clock = new FakeClock(0);
          const logs: string[] = [];
          const logger = new Logger(['SECRET'], (l) => logs.push(l));
          const store = { getDjRole: () => null, getLanguage: () => 'es' };
          const guard = new Guard({
            rateLimiter: new RateLimiter(clock),
            store,
            i18n,
            getBotVoiceChannelId: () => 'vc1',
          });
          const router = new InteractionRouter({ guard, logger, i18n, clock, store });
          const message = `ERR${token} C:\\secret\\${token}.ts${withSecret ? ' SECRET' : ''}`;
          const err = new Error(message);
          err.stack = `Error: ${message}\n    at /srv/app/${token}.js:1:1`;
          let fail = true;
          router.register(commandName, {
            slow,
            run: async (c) => {
              if (fail) throw err;
              await c.respond('ok');
            },
          });

          const first = makeCtx({ commandName, userId, guildId });
          await router.handle(first.ctx);
          expect(first.replies).toEqual([generic]);
          expect(first.replies[0]).not.toContain(token);
          expect(first.replies[0]).not.toMatch(/\.ts|\.js|SECRET|at \//);

          expect(logs.length).toBeGreaterThan(0);
          const log = logs.join('\n');
          expect(log).toContain(commandName);
          expect(log).toContain(userId);
          expect(log).toContain(guildId);
          expect(log).not.toContain('SECRET');

          fail = false;
          const second = makeCtx({ commandName, userId: `${userId}9`, guildId });
          await router.handle(second.ctx);
          expect(second.replies).toEqual(['ok']);
        },
      ),
      { numRuns: 100 },
    );
  });
});
