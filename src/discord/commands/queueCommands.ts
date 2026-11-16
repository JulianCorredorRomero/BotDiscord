import { formatQueuePage, paginateQueue } from '../../core/volume-format.js';
import type { CommandHandler } from '../router.js';
import { optRaw, withGuild, type CommandDeps, type GuildCommandContext } from './shared.js';

type Player = NonNullable<ReturnType<CommandDeps['players']['get']>>;

/** Mismas comprobaciones de canal que GuildPlayer para comandos que operan sobre la Cola. */
function channelError(g: GuildCommandContext, player: Player): string | null {
  if (!g.voiceChannelId) return g.t('error.not_in_voice');
  const botChannel = player.voiceChannelId;
  if (botChannel && botChannel !== g.voiceChannelId) return g.t('cmd.different_channel', { channelId: botChannel });
  return null;
}

export function queueHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const player = deps.players.get(g.guildId);
        const pending = player?.queue.pending ?? [];
        if (!player || pending.length === 0) {
          await ctx.respond(g.t('queue.empty'));
          return;
        }
        const rawPage = optRaw(ctx, 'page');
        const page = paginateQueue(pending, typeof rawPage === 'number' ? rawPage : 1);
        const current = player.queue.current;
        const body = formatQueuePage(page);
        await ctx.respond(current ? `${g.t('queue.now', { title: current.title })}\n${body}` : body);
      }),
  };
}

export function shuffleHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const player = deps.players.get(g.guildId);
        if (!player) {
          await ctx.respond(g.t('cmd.not_playing'));
          return;
        }
        const chErr = channelError(g, player);
        if (chErr) {
          await ctx.respond(chErr);
          return;
        }
        if (player.queue.pending.length < 2) {
          await ctx.respond(g.t('shuffle.not_enough'));
          return;
        }
        player.queue.shuffle(deps.rng ?? Math.random);
        await ctx.respond(g.t('shuffle.done'));
      }),
  };
}

export function removeHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const player = deps.players.get(g.guildId);
        if (!player) {
          await ctx.respond(g.t('queue.empty'));
          return;
        }
        const chErr = channelError(g, player);
        if (chErr) {
          await ctx.respond(chErr);
          return;
        }
        const position = optRaw(ctx, 'position');
        const max = player.queue.pending.length;
        if (typeof position !== 'number') {
          await ctx.respond(g.t('remove.out_of_range', { min: 1, max }));
          return;
        }
        if (max === 0) {
          await ctx.respond(g.t('queue.empty'));
          return;
        }
        const r = player.queue.remove(position);
        if (!r.ok) {
          await ctx.respond(g.t('remove.out_of_range', { min: 1, max }));
          return;
        }
        await ctx.respond(g.t('remove.done', { title: r.value.title, position }));
      }),
  };
}
