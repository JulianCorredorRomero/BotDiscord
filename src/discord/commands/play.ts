import { MAX_QUEUE_SIZE } from '../../core/queue.js';
import type { CommandHandler } from '../router.js';
import { optString, playerErrorMessage, resolveErrorMessage, withGuild, type CommandDeps } from './shared.js';

/** /play: resolver → encolar → responder con la posición o "reproduciendo ahora". */
export function playHandler(deps: CommandDeps): CommandHandler {
  return {
    slow: true,
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        // Req. 1.7: sin canal de voz no se resuelve ni se toca la Cola.
        if (!g.voiceChannelId) {
          await ctx.respond(g.t('error.not_in_voice'));
          return;
        }
        const query = (optString(ctx, 'query') ?? '').trim();
        if (query.length === 0) {
          await ctx.respond(g.t('error.no_results'));
          return;
        }

        const resolved = await deps.resolver.resolve(query, g.userId);
        if (!resolved.ok) {
          await ctx.respond(resolveErrorMessage(g, resolved.error));
          return;
        }

        const isPlaylist = resolved.value.kind === 'playlist';
        const tracks = resolved.value.kind === 'playlist' ? resolved.value.tracks : [resolved.value.track];
        const skipped = resolved.value.kind === 'playlist' ? resolved.value.skipped : 0;

        const existing = deps.players.get(g.guildId);
        const player = existing ?? deps.players.getOrCreate(g.guildId);
        const r = await player.enqueue(tracks, g.voiceChannelId);
        if (!r.ok) {
          if (!existing && !player.connected && !player.queue.current) deps.players.destroy(g.guildId);
          await ctx.respond(playerErrorMessage(g, r.error));
          return;
        }

        const { added, rejected, startedPlayback, position } = r.value;
        if (rejected > 0) {
          await ctx.respond(g.t('play.queue_full', { max: MAX_QUEUE_SIZE, added, rejected }));
          return;
        }
        if (isPlaylist) {
          await ctx.respond(
            skipped > 0
              ? g.t('play.playlist_added_skipped', { added, skipped })
              : g.t('play.playlist_added', { added }),
          );
          return;
        }
        const title = tracks[0]?.title ?? '';
        await ctx.respond(
          startedPlayback ? g.t('play.now_playing', { title }) : g.t('play.queued_track', { title, position }),
        );
      }),
  };
}
