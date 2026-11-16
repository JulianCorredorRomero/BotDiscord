import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { LoopMode, Track } from '../core/types.js';
import { formatDuration } from '../core/volume-format.js';

export const NP_BUTTON_IDS = {
  pause: 'np:pause',
  skip: 'np:skip',
  stop: 'np:stop',
  loop: 'np:loop',
  volUp: 'np:vol_up',
  volDown: 'np:vol_down',
} as const;

export type NowPlayingState = 'reproduciendo' | 'pausado' | 'inactivo' | 'reconectando' | 'sesion_destruida';

export interface NowPlayingButton {
  id: string;
  label: string;
  emoji: string;
  disabled: boolean;
}

export interface NowPlayingModel {
  title: string;
  duration: string;
  requester: string;
  thumbnail: string;
  state: NowPlayingState;
  loop: LoopMode;
  volume: number;
  finished: boolean;
  /** Texto de aviso cuando la reproducción terminó. */
  notice: string | null;
  buttons: NowPlayingButton[];
}

const LOOP_LABEL: Record<LoopMode, string> = {
  off: 'Repetición: desactivada',
  track: 'Repetición: pista',
  queue: 'Repetición: cola',
};

export const FINISHED_NOTICE = 'La reproducción ha finalizado.';

/** Construye el modelo puro del Mensaje_de_Reproducción. */
export function buildNowPlayingModel(
  track: Track,
  requestedBy: string,
  state: NowPlayingState,
  loop: LoopMode,
  volume: number,
  finished = false,
): NowPlayingModel {
  const paused = state === 'pausado';
  const off = finished;
  const buttons: NowPlayingButton[] = [
    {
      id: NP_BUTTON_IDS.pause,
      label: paused ? 'Reanudar' : 'Pausar',
      emoji: paused ? '▶️' : '⏸️',
      disabled: off,
    },
    { id: NP_BUTTON_IDS.skip, label: 'Omitir', emoji: '⏭️', disabled: off },
    { id: NP_BUTTON_IDS.stop, label: 'Detener', emoji: '⏹️', disabled: off },
    { id: NP_BUTTON_IDS.loop, label: LOOP_LABEL[loop], emoji: '🔁', disabled: off },
    { id: NP_BUTTON_IDS.volUp, label: 'Volumen +', emoji: '🔊', disabled: off },
    { id: NP_BUTTON_IDS.volDown, label: 'Volumen -', emoji: '🔉', disabled: off },
  ];
  return {
    title: track.title,
    duration: formatDuration(track.durationSec),
    requester: requestedBy,
    thumbnail: track.thumbnailUrl,
    state,
    loop,
    volume,
    finished,
    notice: finished ? FINISHED_NOTICE : null,
    buttons,
  };
}

/** Representación discord.js: embed y filas de ≤5 botones. */
export function renderNowPlaying(model: NowPlayingModel): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle(model.title || 'Sin título')
    .setDescription(model.notice ?? (model.state === 'pausado' ? 'En pausa' : 'Reproduciendo ahora'))
    .addFields(
      { name: 'Duración', value: model.duration, inline: true },
      { name: 'Solicitada por', value: `<@${model.requester}>`, inline: true },
      { name: 'Volumen', value: `${model.volume}%`, inline: true },
    );
  if (model.thumbnail) embed.setThumbnail(model.thumbnail);

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < model.buttons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const b of model.buttons.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(b.id)
          .setLabel(b.label)
          .setEmoji(b.emoji)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(b.disabled),
      );
    }
    components.push(row);
  }
  return { embeds: [embed], components };
}

/** Puerto de canal de texto/mensaje, inyectable. */
export interface NowPlayingChannelPort {
  /** Publica un mensaje nuevo y devuelve su id. */
  send(model: NowPlayingModel): Promise<string>;
  /** Edita el mensaje; rechaza si falla o fue eliminado. */
  edit(messageId: string, model: NowPlayingModel): Promise<void>;
}

export interface NowPlayingOptions {
  /** Plazo de edición (Req. 6.2). Por defecto 2000 ms. */
  editTimeoutMs?: number;
  /** Plazo de recreación (Req. 6.11). Por defecto 5000 ms. */
  recreateTimeoutMs?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class NowPlayingMessage {
  private messageId: string | null = null;
  private readonly editTimeoutMs: number;
  private readonly recreateTimeoutMs: number;
  private last: NowPlayingModel | null = null;

  constructor(
    private readonly port: NowPlayingChannelPort,
    opts: NowPlayingOptions = {},
  ) {
    this.editTimeoutMs = opts.editTimeoutMs ?? 2000;
    this.recreateTimeoutMs = opts.recreateTimeoutMs ?? 5000;
  }

  get ref(): string | null {
    return this.messageId;
  }

  get model(): NowPlayingModel | null {
    return this.last;
  }

  /** Publica el mensaje de una pista nueva. */
  async post(model: NowPlayingModel): Promise<boolean> {
    this.last = model;
    return this.create(model);
  }

  /** Actualiza el mensaje; si falla o fue eliminado, publica uno nuevo. */
  async update(model: NowPlayingModel): Promise<boolean> {
    this.last = model;
    if (this.messageId === null) return this.create(model);
    try {
      await withTimeout(this.port.edit(this.messageId, model), this.editTimeoutMs);
      return true;
    } catch {
      return this.create(model);
    }
  }

  /** Marca la reproducción como finalizada con botones desactivados. */
  async finish(track: Track, requestedBy: string, loop: LoopMode, volume: number): Promise<boolean> {
    return this.update(buildNowPlayingModel(track, requestedBy, 'inactivo', loop, volume, true));
  }

  private async create(model: NowPlayingModel): Promise<boolean> {
    try {
      this.messageId = await withTimeout(this.port.send(model), this.recreateTimeoutMs);
      return true;
    } catch {
      this.messageId = null;
      return false;
    }
  }
}
