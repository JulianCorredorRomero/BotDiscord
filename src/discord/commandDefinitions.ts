import { SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { LOOP_MODES } from '../core/types.js';

/** Definiciones de los slash commands del Bot (Req. 9.9). */
export function buildCommandDefinitions(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Reproduce un enlace o busca en YouTube')
      .addStringOption((o) =>
        o.setName('query').setDescription('Enlace o texto de búsqueda').setRequired(true).setAutocomplete(true),
      ),
    new SlashCommandBuilder().setName('pause').setDescription('Pausa la reproducción'),
    new SlashCommandBuilder().setName('resume').setDescription('Reanuda la reproducción'),
    new SlashCommandBuilder().setName('skip').setDescription('Salta a la siguiente pista'),
    new SlashCommandBuilder().setName('stop').setDescription('Detiene la reproducción y vacía la cola'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('Muestra la pista actual'),
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Muestra la cola')
      .addIntegerOption((o) => o.setName('page').setDescription('Número de página').setMinValue(1)),
    new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Cambia el modo de repetición')
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Modo de repetición')
          .setRequired(true)
          .addChoices(...LOOP_MODES.map((m) => ({ name: m, value: m }))),
      ),
    new SlashCommandBuilder().setName('shuffle').setDescription('Mezcla las pistas pendientes'),
    new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Elimina una pista de la cola')
      .addIntegerOption((o) =>
        o.setName('position').setDescription('Posición en la cola (desde 1)').setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Muestra o cambia el volumen')
      .addIntegerOption((o) =>
        o.setName('value').setDescription('Volumen de 0 a 100').setMinValue(0).setMaxValue(100),
      ),
    new SlashCommandBuilder()
      .setName('playlist')
      .setDescription('Gestiona tus listas de reproducción')
      .addSubcommand((s) =>
        s
          .setName('save')
          .setDescription('Guarda la pista actual y la cola como lista')
          .addStringOption((o) =>
            o.setName('name').setDescription('Nombre de la lista').setRequired(true).setMinLength(1).setMaxLength(50),
          )
          .addBooleanOption((o) =>
            o.setName('confirm').setDescription('Confirma (true) o cancela (false) la sobrescritura'),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('load')
          .setDescription('Añade una lista a la cola')
          .addStringOption((o) => o.setName('name').setDescription('Nombre de la lista').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('Muestra tus listas'))
      .addSubcommand((s) =>
        s
          .setName('delete')
          .setDescription('Elimina una de tus listas')
          .addStringOption((o) => o.setName('name').setDescription('Nombre de la lista').setRequired(true)),
      ),
    new SlashCommandBuilder()
      .setName('dj')
      .setDescription('Configura el Rol DJ (solo administradores)')
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Establece el Rol DJ')
          .addRoleOption((o) => o.setName('role').setDescription('Rol DJ').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('clear').setDescription('Elimina el Rol DJ')),
  ];

  return commands.map((c) => c.setDMPermission(false).toJSON());
}
