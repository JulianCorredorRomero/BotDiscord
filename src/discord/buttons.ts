import type { I18n } from '../core/i18n.js';
import { LOOP_MODES, type LoopMode } from '../core/types.js';
import type { PlayerManager } from '../player/playerManager.js';
import type { Store } from '../store/store.js';
import type { Guard, InteractionContext } from './guard.js';
import { NP_BUTTON_IDS } from './nowPlayingMessage.js';
import { playerErrorMessage, type GuildCommandContext } from './commands/shared.js';

/** Interacción de botón: contexto común más acuse de recibo sin mensaje nuevo. */
export interface ButtonContext extends InteractionContext {
  customId: string;
  /** Confirma el clic sin enviar mensaje (deferUpdate). */
  deferUpdate(): Promise<void>;
}

export interface ButtonDeps {
  guard: Guard;
  players: Pick<PlayerManager, 'get'>;
  store: Pick<Store, 'getLanguage'>;
  i18n: I18n;
  /** Se invoca tras una acción correcta para actualizar el Mensaje_de_Reproducción. */
  onPlaybackChanged?: (guildId: string) => Promise<void> | void;
}

export function nextLoopMode(mode: LoopMode): LoopMode {
  const i = LOOP_MODES.indexOf(mode);
  return LOOP_MODES[(i + 1) % LOOP_MODES.length]!;
}

export function isNowPlayingButton(customId: string): boolean {
  return (Object.values(NP_BUTTON_IDS) as string[]).includes(customId);
}

/**
 * Ejecuta la acción equivalente a un botón del Mensaje_de_Reproducción con las
 * mismas comprobaciones del Guard que el comando. Los rechazos son efímeros y no
 * modifican la reproducción. Devuelve true si el botón se reconoció.
 */
export async function handleButton(deps: ButtonDeps, btn: ButtonContext): Promise<boolean> {
  if (!isNowPlayingButton(btn.customId)) return false;
  const { guard, players, i18n, store } = deps;

  try {
    const verdict = guard.check(btn);
    if (!verdict.ok) {
      await btn.reply(verdict.message, { ephemeral: true });
      return true;
    }

    let lang: string | undefined;
    try {
      lang = btn.guildId ? store.getLanguage(btn.guildId) : undefined;
    } catch {
      lang = undefined;
    }
    const t: GuildCommandContext['t'] = (key, params) => i18n.t(key, lang, params);

    const player = btn.guildId ? players.get(btn.guildId) : undefined;
    if (!btn.guildId || !player || !player.nowPlaying().ok) {
      await btn.reply(t('cmd.not_playing'), { ephemeral: true });
      return true;
    }

    const vc = btn.member?.voiceChannelId ?? null;
    let error: Parameters<typeof playerErrorMessage>[1] | null = null;
    // Se acusa recibo antes de la acción (puede tardar); los errores van como followUp efímero.
    await btn.deferUpdate();

    switch (btn.customId) {
      case NP_BUTTON_IDS.pause: {
        const r = player.state === 'pausado' ? await player.resume(vc) : await player.pause(vc);
        if (!r.ok) error = r.error;
        break;
      }
      case NP_BUTTON_IDS.skip: {
        const r = await player.skip(vc);
        if (!r.ok) error = r.error;
        break;
      }
      case NP_BUTTON_IDS.stop: {
        const r = await player.stop(vc);
        if (!r.ok) error = r.error;
        break;
      }
      case NP_BUTTON_IDS.loop: {
        const r = player.setLoop(vc, nextLoopMode(player.loop));
        if (!r.ok) error = r.error.reason === 'invalid_loop_mode' ? { reason: 'nothing_playing' } : r.error;
        break;
      }
      case NP_BUTTON_IDS.volUp:
      case NP_BUTTON_IDS.volDown: {
        const r = player.adjustVolume(vc, btn.customId === NP_BUTTON_IDS.volUp ? 10 : -10);
        if (!r.ok) error = r.error.reason === 'invalid_volume' ? { reason: 'nothing_playing' } : r.error;
        break;
      }
    }

    if (error) {
      const g = { t } as GuildCommandContext;
      await btn.followUp(playerErrorMessage(g, error), { ephemeral: true });
      return true;
    }
    if (deps.onPlaybackChanged) await deps.onPlaybackChanged(btn.guildId);
  } catch {
    try {
      await btn.followUp(deps.i18n.t('error.generic'), { ephemeral: true });
    } catch {
      /* sin canal de respuesta */
    }
  }
  return true;
}
