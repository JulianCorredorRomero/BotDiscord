import {
  MessageFlags,
  type AutocompleteInteraction,
  type Interaction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import type { InteractionContext } from './guard.js';
import { NP_BUTTON_IDS } from './nowPlayingMessage.js';
import { handleButton, type ButtonContext, type ButtonDeps } from './buttons.js';
import { handleAutocomplete, type AutocompleteContext, type AutocompleteDeps } from './autocomplete.js';

type Repliable = ChatInputCommandInteraction | ButtonInteraction;

/** Comando equivalente de cada botón del Mensaje_de_Reproducción (mismo Guard, Req. 6.3). */
export const BUTTON_COMMANDS: Record<string, string> = {
  [NP_BUTTON_IDS.pause]: 'pause',
  [NP_BUTTON_IDS.skip]: 'skip',
  [NP_BUTTON_IDS.stop]: 'stop',
  [NP_BUTTON_IDS.loop]: 'loop',
  [NP_BUTTON_IDS.volUp]: 'volume',
  [NP_BUTTON_IDS.volDown]: 'volume',
};

function memberInfo(i: Repliable): InteractionContext['member'] {
  const m = i.member as GuildMember | null;
  if (!m || !('roles' in m) || Array.isArray(m.roles)) {
    return i.inGuild() ? { roleIds: [], isAdmin: false, voiceChannelId: null } : null;
  }
  return {
    roleIds: [...m.roles.cache.keys()],
    isAdmin: m.permissions.has(PermissionFlagsBits.Administrator),
    voiceChannelId: m.voice?.channelId ?? null,
  };
}

function wrap(i: Repliable, commandName: string, subcommand: string | null, optionNames: string[]): InteractionContext {
  const flags = (ephemeral?: boolean) => (ephemeral ? MessageFlags.Ephemeral : undefined);
  return {
    userId: i.user.id,
    guildId: i.guildId,
    commandName,
    subcommand,
    optionNames,
    member: memberInfo(i),
    async reply(content, opts) {
      await i.reply({ content, flags: flags(opts?.ephemeral) });
    },
    async deferReply(opts) {
      await i.deferReply({ flags: flags(opts?.ephemeral) });
    },
    async editReply(content) {
      await i.editReply({ content });
    },
    async followUp(content, opts) {
      await i.followUp({ content, flags: flags(opts?.ephemeral) });
    },
  };
}

export function fromChatInput(i: ChatInputCommandInteraction): InteractionContext {
  const sub = i.options.getSubcommand(false);
  const names = i.options.data.flatMap((o) => (o.options ? o.options.map((x) => x.name) : [o.name]));
  const options: Record<string, string | number | boolean> = {};
  for (const o of i.options.data.flatMap((x) => (x.options ? x.options : [x]))) {
    if (o.value !== undefined && o.value !== null) options[o.name] = o.value;
  }
  return { ...wrap(i, i.commandName, sub, names), options };
}

/** Botón con deferUpdate; null si no pertenece al Mensaje_de_Reproducción. */
export function toButtonContext(i: ButtonInteraction): ButtonContext | null {
  const base = fromButton(i);
  if (!base) return null;
  return { ...base, customId: i.customId, deferUpdate: async () => void (await i.deferUpdate()) };
}

export function fromAutocomplete(i: AutocompleteInteraction): AutocompleteContext {
  const focused = i.options.getFocused(true);
  return {
    commandName: i.commandName,
    focusedName: focused.name,
    query: String(focused.value ?? ''),
    respond: async (choices) => void (await i.respond(choices)),
  };
}

/** Minimal del cliente discord.js necesario para el cableado. */
export interface InteractionSource {
  on(event: 'interactionCreate', listener: (i: Interaction) => void): unknown;
}

/** Enlaza botones y autocompletado al cliente. Los comandos de barra siguen en el router. */
export function registerInteractionHandlers(
  client: InteractionSource,
  deps: { buttons: ButtonDeps; autocomplete: AutocompleteDeps },
): void {
  client.on('interactionCreate', (i) => {
    if (i.isButton()) {
      const ctx = toButtonContext(i);
      if (ctx) void handleButton(deps.buttons, ctx).catch(() => undefined);
    } else if (i.isAutocomplete()) {
      void handleAutocomplete(deps.autocomplete, fromAutocomplete(i)).catch(() => undefined);
    }
  });
}

/** Devuelve null si el botón no pertenece al Mensaje_de_Reproducción. */
export function fromButton(i: ButtonInteraction): InteractionContext | null {
  const cmd = BUTTON_COMMANDS[i.customId];
  if (!cmd) return null;
  // optionNames con 'value' evita tratar los botones de volumen como consulta efímera.
  return wrap(i, cmd, i.customId, ['value']);
}
