import type { Clock } from '../core/clock.js';
import type { I18n } from '../core/i18n.js';
import type { Logger } from '../core/logger.js';
import type { Store } from '../store/store.js';
import type { Guard, InteractionContext } from './guard.js';

/** Contexto que recibe el manejador: respuestas ya coordinadas con deferReply. */
export interface HandlerContext {
  interaction: InteractionContext;
  /** Responde (reply, editReply o followUp según el estado). */
  respond(content: string): Promise<void>;
}

export interface CommandHandler {
  /** true si la operación puede tardar: se difiere la respuesta de inmediato. */
  slow?: boolean;
  run(ctx: HandlerContext): Promise<void>;
}

export interface RouterDeps {
  guard: Guard;
  logger: Logger;
  i18n: I18n;
  clock: Clock;
  store: Pick<Store, 'getLanguage'>;
  /** Tiempo tras el cual se difiere si no hubo respuesta (por defecto 2000 ms < 3 s). */
  deferAfterMs?: number;
}

/** Comandos de consulta: respuesta efímera (Req. 6.8). */
export function isQueryCommand(ctx: Pick<InteractionContext, 'commandName' | 'subcommand' | 'optionNames'>): boolean {
  switch (ctx.commandName) {
    case 'queue':
    case 'nowplaying':
      return true;
    case 'volume':
      return !ctx.optionNames.includes('value') && !ctx.optionNames.includes('level') && !ctx.optionNames.includes('volume');
    case 'playlist':
      return ctx.subcommand === 'list';
    default:
      return false;
  }
}

export class InteractionRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(private readonly deps: RouterDeps) {}

  register(name: string, handler: CommandHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  async handle(interaction: InteractionContext): Promise<void> {
    const { guard, logger, i18n, clock, store } = this.deps;
    const lang = interaction.guildId ? safeLang(store, interaction.guildId) : undefined;
    const ephemeral = isQueryCommand(interaction);

    let deferPromise: Promise<void> | null = null;
    let replied = false;
    let timer: number | null = null;

    const defer = (): Promise<void> => {
      if (!deferPromise && !replied) deferPromise = interaction.deferReply({ ephemeral });
      return deferPromise ?? Promise.resolve();
    };
    const respond = async (content: string): Promise<void> => {
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
      if (deferPromise) {
        await deferPromise;
        if (!replied) {
          replied = true;
          await interaction.editReply(content);
          return;
        }
        await interaction.followUp(content, { ephemeral });
        return;
      }
      if (!replied) {
        replied = true;
        await interaction.reply(content, { ephemeral });
        return;
      }
      await interaction.followUp(content, { ephemeral });
    };

    try {
      const verdict = guard.check(interaction);
      if (!verdict.ok) {
        replied = true;
        await interaction.reply(verdict.message, { ephemeral: true });
        return;
      }

      const handler = this.handlers.get(interaction.commandName);
      if (!handler) {
        replied = true;
        await interaction.reply(i18n.t('error.unknown_command', lang), { ephemeral: true });
        return;
      }

      if (handler.slow) await defer();
      else timer = clock.setTimeout(() => void defer().catch(() => undefined), this.deps.deferAfterMs ?? 2000);

      await handler.run({ interaction, respond });
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      try {
        logger.log(
          'command_error',
          `command=${interaction.commandName} userId=${interaction.userId} error=${detail}`,
          interaction.guildId,
        );
      } catch {
        /* el registro no debe romper el router */
      }
      try {
        await respond(i18n.t('error.generic', lang));
      } catch {
        /* sin canal de respuesta: seguir operativo */
      }
    } finally {
      if (timer !== null) clock.clearTimeout(timer);
    }
  }
}

function safeLang(store: Pick<Store, 'getLanguage'>, guildId: string): string | undefined {
  try {
    return store.getLanguage(guildId);
  } catch {
    return undefined;
  }
}
