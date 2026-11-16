import { MAX_PLAYLISTS_PER_USER, MAX_PLAYLIST_TRACKS } from '../../core/playlist.js';
import type { ConfirmResult, SaveResult } from '../../services/playlistService.js';
import type { CommandHandler } from '../router.js';
import {
  optBoolean,
  optString,
  playerErrorMessage,
  withGuild,
  type CommandDeps,
  type GuildCommandContext,
} from './shared.js';

function saveMessage(g: GuildCommandContext, r: SaveResult | ConfirmResult, timeoutSec = 30): string {
  switch (r.status) {
    case 'saved':
      return g.t('playlist.saved', { name: r.name, count: r.trackCount });
    case 'confirm_required':
      return g.t('playlist.confirm_overwrite', { name: r.name, seconds: Math.round(r.timeoutMs / 1000) || timeoutSec });
    case 'empty':
      return g.t('playlist.empty_queue');
    case 'too_many_tracks':
      return g.t('playlist.too_many_tracks', { max: MAX_PLAYLIST_TRACKS });
    case 'too_many_playlists':
      return g.t('playlist.too_many_playlists', { max: MAX_PLAYLISTS_PER_USER });
    case 'bad_name':
      return g.t('playlist.bad_name');
    case 'cancelled':
      return g.t(r.reason === 'expired' ? 'playlist.cancelled_expired' : 'playlist.cancelled');
    case 'store_error':
      return g.t('playlist.store_error');
  }
}

/** /playlist save|load|list|delete. */
export function playlistHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const sub = ctx.interaction.subcommand;
        const name = optString(ctx, 'name') ?? '';

        switch (sub) {
          case 'save': {
            const confirm = optBoolean(ctx, 'confirm');
            if (confirm !== null && deps.playlists.hasPendingConfirmation(g.guildId, g.userId, name)) {
              await ctx.respond(saveMessage(g, deps.playlists.confirmSave(g.guildId, g.userId, name, confirm)));
              return;
            }
            const player = deps.players.get(g.guildId);
            const r = deps.playlists.save({
              guildId: g.guildId,
              userId: g.userId,
              name,
              current: player?.queue.current ?? null,
              pending: player?.queue.pending ?? [],
              onExpire: () => {
                ctx.interaction
                  .followUp(g.t('playlist.cancelled_expired'), { ephemeral: true })
                  .catch(() => undefined);
              },
            });
            await ctx.respond(saveMessage(g, r));
            return;
          }

          case 'load': {
            const existing = deps.players.get(g.guildId);
            const player = existing ?? deps.players.getOrCreate(g.guildId);
            const cleanup = (): void => {
              if (!existing && !player.queue.current && player.queue.pending.length === 0) {
                deps.players.destroy(g.guildId);
              }
            };
            // Comprueba canal y permisos y se conecta antes de tocar la Cola.
            const joined = await player.enqueue([], g.voiceChannelId);
            if (!joined.ok) {
              cleanup();
              await ctx.respond(playerErrorMessage(g, joined.error));
              return;
            }
            const r = deps.playlists.load({ guildId: g.guildId, userId: g.userId, name, queue: player.queue });
            if (r.status === 'loaded') {
              if (!player.queue.current && player.queue.pending.length > 0) {
                await player.enqueue([], g.voiceChannelId);
              }
              await ctx.respond(
                r.rejected > 0
                  ? g.t('playlist.loaded_rejected', { name: r.name, added: r.added, rejected: r.rejected })
                  : g.t('playlist.loaded', { name: r.name, added: r.added }),
              );
              return;
            }
            cleanup();
            await ctx.respond(r.status === 'not_found' ? g.t('playlist.not_found') : g.t('playlist.store_error'));
            return;
          }

          case 'list': {
            const r = deps.playlists.list(g.guildId, g.userId);
            if (r.status === 'empty') {
              await ctx.respond(g.t('playlist.list_empty'));
              return;
            }
            await ctx.respond(
              r.playlists.map((p) => g.t('playlist.list_item', { name: p.name, count: p.trackCount })).join('\n'),
            );
            return;
          }

          case 'delete': {
            const r = deps.playlists.delete({ guildId: g.guildId, userId: g.userId, name });
            switch (r.status) {
              case 'deleted':
                await ctx.respond(g.t('playlist.deleted', { name: r.name }));
                return;
              case 'not_found':
                await ctx.respond(g.t('playlist.not_found'));
                return;
              case 'not_creator':
                await ctx.respond(g.t('playlist.not_creator'));
                return;
              case 'store_error':
                await ctx.respond(g.t('playlist.store_error'));
                return;
            }
            return;
          }

          default:
            await ctx.respond(g.t('error.unknown_command'));
        }
      }),
  };
}
