import type { RateLimiter } from '../core/rateLimiter.js';
import { canExecute } from '../core/permissions.js';
import type { I18n } from '../core/i18n.js';
import { COMMAND_NAMES, type CommandName } from '../core/types.js';
import type { Store } from '../store/store.js';

/** Abstracción mínima de una interacción de Discord (comando, botón o autocompletado). */
export interface InteractionContext {
  userId: string;
  guildId: string | null;
  /** Nombre del comando; para botones, el del comando equivalente. */
  commandName: string;
  subcommand?: string | null;
  /** Nombres de las opciones proporcionadas por el usuario. */
  optionNames: string[];
  /** Valores de las opciones proporcionadas (roles y canales como id). */
  options?: Readonly<Record<string, string | number | boolean>>;
  member: { roleIds: string[]; isAdmin: boolean; voiceChannelId: string | null } | null;
  reply(content: string, opts?: { ephemeral?: boolean }): Promise<void>;
  deferReply(opts?: { ephemeral?: boolean }): Promise<void>;
  editReply(content: string): Promise<void>;
  followUp(content: string, opts?: { ephemeral?: boolean }): Promise<void>;
}

export type GuardResult = { ok: true } | { ok: false; message: string };

export interface GuardDeps {
  rateLimiter: RateLimiter;
  store: Pick<Store, 'getDjRole' | 'getLanguage'>;
  i18n: I18n;
  /** Canal de voz del Bot en el Servidor, o null si no está conectado. */
  getBotVoiceChannelId: (guildId: string) => string | null;
  /** Comandos cuya autorización se delega al manejador (por defecto: dj, que exige administrador). */
  permissionExempt?: ReadonlySet<string>;
}

const isCommandName = (n: string): n is CommandName => (COMMAND_NAMES as readonly string[]).includes(n);

/**
 * Encadena límite de uso → permisos. Las comprobaciones de canal de voz
 * (usuario/bot en el mismo canal, permisos Connect/Speak) las hace GuildPlayer.
 * Un rechazo nunca modifica el estado.
 */
export class Guard {
  private readonly exempt: ReadonlySet<string>;

  constructor(private readonly deps: GuardDeps) {
    this.exempt = deps.permissionExempt ?? new Set(['dj']);
  }

  check(ctx: InteractionContext): GuardResult {
    const { rateLimiter, store, i18n } = this.deps;
    const lang = ctx.guildId ? store.getLanguage(ctx.guildId) : undefined;

    const rate = rateLimiter.check(ctx.userId);
    if (!rate.allowed) {
      return {
        ok: false,
        message: i18n.t('error.rate_limited', lang, { seconds: Math.ceil(rate.retryAfterSec) }),
      };
    }

    if (!isCommandName(ctx.commandName) || this.exempt.has(ctx.commandName)) return { ok: true };

    const djRoleId = ctx.guildId ? store.getDjRole(ctx.guildId) : null;
    const botChannel = ctx.guildId ? this.deps.getBotVoiceChannelId(ctx.guildId) : null;
    const userChannel = ctx.member?.voiceChannelId ?? null;
    // Si el Bot aún no está en un canal, basta con que el usuario esté en alguno
    // (GuildPlayer valida el resto al unirse).
    const inBotVoiceChannel = userChannel !== null && (botChannel === null || botChannel === userChannel);

    const decision = canExecute(
      ctx.commandName,
      {
        roleIds: ctx.member?.roleIds ?? [],
        isAdmin: ctx.member?.isAdmin ?? false,
        inBotVoiceChannel,
      },
      djRoleId,
    );
    if (decision.allowed) return { ok: true };
    return {
      ok: false,
      message: i18n.t(decision.reason === 'requires_dj' ? 'error.requires_dj' : 'error.not_in_voice', lang),
    };
  }
}
