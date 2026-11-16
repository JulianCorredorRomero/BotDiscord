import type { CommandHandler } from '../router.js';
import { optString, withGuild, type CommandDeps } from './shared.js';

/** /dj set|clear: solo administradores (Req. 8.3, 8.4, 8.5). */
export function djHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const isAdmin = ctx.interaction.member?.isAdmin ?? false;
        if (!isAdmin) {
          await ctx.respond(g.t('dj.requires_admin'));
          return;
        }
        const sub = ctx.interaction.subcommand;
        const roleId = optString(ctx, 'role');
        const r =
          sub === 'set' && roleId
            ? deps.dj.set({ guildId: g.guildId, roleId, isAdmin })
            : sub === 'clear'
              ? deps.dj.clear({ guildId: g.guildId, isAdmin })
              : null;
        if (!r) {
          await ctx.respond(g.t('error.generic'));
          return;
        }
        switch (r.status) {
          case 'set':
            await ctx.respond(g.t('dj.set', { roleId: r.roleId }));
            return;
          case 'cleared':
            await ctx.respond(g.t('dj.cleared'));
            return;
          case 'forbidden':
            await ctx.respond(g.t('dj.requires_admin'));
            return;
          case 'store_error':
            await ctx.respond(g.t('dj.store_error'));
            return;
        }
      }),
  };
}
