import { LOOP_MODES } from '../../core/types.js';
import { formatNowPlaying, parseVolumeArg, validateLoopMode } from '../../core/volume-format.js';
import type { PlayerError } from '../../player/guildPlayer.js';
import type { Result } from '../../core/result.js';
import type { CommandHandler } from '../router.js';
import { optRaw, playerErrorMessage, withGuild, type CommandDeps, type GuildCommandContext } from './shared.js';

type Simple = (player: NonNullable<ReturnType<CommandDeps['players']['get']>>, vc: string | null) => Promise<Result<unknown, PlayerError>>;

function simpleControl(deps: CommandDeps, run: Simple, okKey: 'pause.done' | 'resume.done' | 'stop.done'): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const player = deps.players.get(g.guildId);
        if (!player) {
          await ctx.respond(g.t('cmd.not_playing'));
          return;
        }
        const r = await run(player, g.voiceChannelId);
        await ctx.respond(r.ok ? g.t(okKey) : playerErrorMessage(g, r.error));
      }),
  };
}

export const pauseHandler = (deps: CommandDeps): CommandHandler =>
  simpleControl(deps, (p, vc) => p.pause(vc), 'pause.done');

export const resumeHandler = (deps: CommandDeps): CommandHandler =>
  simpleControl(deps, (p, vc) => p.resume(vc), 'resume.done');

export const stopHandler = (deps: CommandDeps): CommandHandler =>
  simpleControl(deps, (p, vc) => p.stop(vc), 'stop.done');

export function skipHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const player = deps.players.get(g.guildId);
        if (!player) {
          await ctx.respond(g.t('cmd.not_playing'));
          return;
        }
        const r = await player.skip(g.voiceChannelId);
        if (!r.ok) {
          await ctx.respond(playerErrorMessage(g, r.error));
          return;
        }
        const next = r.value.next;
        await ctx.respond(next ? g.t('skip.next', { title: next.title }) : g.t('skip.done'));
      }),
  };
}

export function nowPlayingHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const info = deps.players.get(g.guildId)?.nowPlaying();
        if (!info || !info.ok) {
          await ctx.respond(g.t('cmd.not_playing'));
          return;
        }
        const { track, positionSec, state } = info.value;
        const text = formatNowPlaying(track, positionSec);
        await ctx.respond(state === 'pausado' ? `${text}\n${g.t('nowplaying.paused')}` : text);
      }),
  };
}

export function loopHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const mode = optRaw(ctx, 'mode');
        // Req. 2.8: modo inválido → modos válidos, sin tocar el estado.
        const valid = validateLoopMode(mode);
        if (!valid.ok) {
          await ctx.respond(g.t('loop.invalid', { valid: LOOP_MODES.join(', ') }));
          return;
        }
        const player = deps.players.get(g.guildId);
        if (!player) {
          await ctx.respond(g.t('cmd.not_playing'));
          return;
        }
        const r = player.setLoop(g.voiceChannelId, valid.value);
        if (r.ok) {
          await ctx.respond(g.t('loop.set', { mode: r.value }));
        } else if (r.error.reason === 'invalid_loop_mode') {
          await ctx.respond(g.t('loop.invalid', { valid: r.error.valid.join(', ') }));
        } else {
          await ctx.respond(playerErrorMessage(g, r.error));
        }
      }),
  };
}

async function showVolume(deps: CommandDeps, g: GuildCommandContext): Promise<void> {
  const player = deps.players.get(g.guildId);
  const volume = player ? player.getVolume() : deps.volume.get(g.guildId);
  await g.ctx.respond(g.t('volume.current', { volume }));
}

export function volumeHandler(deps: CommandDeps): CommandHandler {
  return {
    run: (ctx) =>
      withGuild(deps, ctx, async (g) => {
        const raw = optRaw(ctx, 'value');
        if (raw === null) {
          await showVolume(deps, g);
          return;
        }
        // Req. 3.3: valor inválido → rango válido, sin cambiar nada.
        if (!parseVolumeArg(raw).ok) {
          await ctx.respond(g.t('error.invalid_volume'));
          return;
        }
        const player = deps.players.get(g.guildId);
        if (player) {
          const r = player.setVolume(g.voiceChannelId, raw);
          if (!r.ok) {
            await ctx.respond(r.error.reason === 'invalid_volume' ? g.t('error.invalid_volume') : playerErrorMessage(g, r.error));
            return;
          }
          await ctx.respond(
            r.value.saved
              ? g.t('volume.set', { volume: r.value.volume })
              : g.t('volume.not_saved', { volume: r.value.volume }),
          );
          return;
        }
        const r = deps.volume.set(g.guildId, raw);
        if (r.status === 'invalid') await ctx.respond(g.t('error.invalid_volume'));
        else if (r.status === 'not_saved') await ctx.respond(g.t('volume.not_saved', { volume: r.volume }));
        else await ctx.respond(g.t('volume.set', { volume: r.volume }));
      }),
  };
}
