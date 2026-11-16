import type { CommandName } from './types.js';

export const RESTRICTED: ReadonlySet<CommandName> = new Set<CommandName>([
  'skip',
  'stop',
  'volume',
  'shuffle',
  'remove',
  'loop',
]);

export interface MemberInfo {
  roleIds: string[];
  isAdmin: boolean;
  inBotVoiceChannel: boolean;
}

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: 'requires_dj' | 'not_in_voice_channel' };

/**
 * Decide si un miembro puede ejecutar un Comando.
 * Con Rol_DJ: los restringidos exigen Rol_DJ o administrador; el resto se permite.
 * Sin Rol_DJ: se exige estar en el Canal_de_Voz del Bot.
 */
export function canExecute(
  cmd: CommandName,
  member: MemberInfo,
  djRoleId: string | null,
): Decision {
  if (djRoleId !== null) {
    if (!RESTRICTED.has(cmd) || member.isAdmin || member.roleIds.includes(djRoleId)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'requires_dj' };
  }
  return member.inBotVoiceChannel
    ? { allowed: true }
    : { allowed: false, reason: 'not_in_voice_channel' };
}
