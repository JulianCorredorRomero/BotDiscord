import type { I18n, MessageKey } from '../../core/i18n.js';
import type { PlayerError } from '../../player/guildPlayer.js';
import type { PlayerManager } from '../../player/playerManager.js';
import type { ResolveError, Resolver } from '../../resolver/resolver.js';
import type { DjService } from '../../services/djService.js';
import type { PlaylistService } from '../../services/playlistService.js';
import type { VolumeService } from '../../services/volumeService.js';
import type { Store } from '../../store/store.js';
import type { HandlerContext } from '../router.js';

/** Dependencias de los manejadores de comandos. */
export interface CommandDeps {
  resolver: Pick<Resolver, 'resolve'>;
  players: Pick<PlayerManager, 'get' | 'getOrCreate' | 'destroy'>;
  store: Pick<Store, 'getLanguage'>;
  playlists: PlaylistService;
  volume: VolumeService;
  dj: DjService;
  i18n: I18n;
  /** Generador aleatorio para /shuffle (por defecto Math.random). */
  rng?: () => number;
}

/** Contexto ya comprobado como de servidor. */
export interface GuildCommandContext {
  ctx: HandlerContext;
  guildId: string;
  userId: string;
  /** Canal de voz del usuario, o null. */
  voiceChannelId: string | null;
  lang: string | undefined;
  t(key: MessageKey, params?: Record<string, string | number>): string;
}

export function guildContext(deps: CommandDeps, ctx: HandlerContext): GuildCommandContext | null {
  const i = ctx.interaction;
  if (!i.guildId) return null;
  const guildId = i.guildId;
  let lang: string | undefined;
  try {
    lang = deps.store.getLanguage(guildId);
  } catch {
    lang = undefined;
  }
  return {
    ctx,
    guildId,
    userId: i.userId,
    voiceChannelId: i.member?.voiceChannelId ?? null,
    lang,
    t: (key, params) => deps.i18n.t(key, lang, params),
  };
}

/** Ejecuta `fn` con el contexto de servidor; responde con un error si es un mensaje directo. */
export async function withGuild(
  deps: CommandDeps,
  ctx: HandlerContext,
  fn: (g: GuildCommandContext) => Promise<void>,
): Promise<void> {
  const g = guildContext(deps, ctx);
  if (!g) {
    await ctx.respond(deps.i18n.t('cmd.guild_only'));
    return;
  }
  await fn(g);
}

export function optString(ctx: HandlerContext, name: string): string | null {
  const v = ctx.interaction.options?.[name];
  return typeof v === 'string' ? v : null;
}

/** Devuelve el valor tal cual (número o cadena) para validarlo después; null si no se indicó. */
export function optRaw(ctx: HandlerContext, name: string): string | number | boolean | null {
  const v = ctx.interaction.options?.[name];
  return v === undefined ? null : v;
}

export function optBoolean(ctx: HandlerContext, name: string): boolean | null {
  const v = ctx.interaction.options?.[name];
  return typeof v === 'boolean' ? v : null;
}

/** Errores comunes de GuildPlayer → mensaje localizado. */
export function playerErrorMessage(g: GuildCommandContext, e: PlayerError): string {
  switch (e.reason) {
    case 'not_in_voice':
      return g.t('error.not_in_voice');
    case 'different_channel':
      return g.t('cmd.different_channel', { channelId: e.channelId });
    case 'missing_permission':
      return g.t('cmd.missing_permission', { permission: e.permission });
    case 'nothing_playing':
      return g.t('cmd.not_playing');
    case 'connect_failed':
      return g.t('cmd.connect_failed');
  }
}

const RESOLVE_KEYS: Record<ResolveError, MessageKey> = {
  invalid_link: 'resolve.invalid_link',
  'unavailable:deleted': 'resolve.deleted',
  'unavailable:private': 'resolve.private',
  'unavailable:region': 'resolve.region',
  age_restricted: 'resolve.age_restricted',
  no_results: 'error.no_results',
  timeout: 'resolve.timeout',
};

export function resolveErrorMessage(g: GuildCommandContext, e: ResolveError): string {
  return g.t(RESOLVE_KEYS[e]);
}
