import { selectOpusBitrate } from '../core/volume-format.js';
import { CHANNELS, SAMPLE_RATE } from './pcmTransformer.js';

export const TARGET_LUFS = -16;
export const TRUE_PEAK_DBTP = -1;
export const FADE_IN_SEC = 0.5;

/** -1 dBFS en escala lineal. */
export const LIMIT_LINEAR = Math.pow(10, TRUE_PEAK_DBTP / 20);

/**
 * Techo interno del limitador. Se deja 0,5 dB de margen bajo -1 dBTP porque al volver
 * de 192 kHz a 48 kHz el remuestreo añade un pequeño sobrepico (medido: -0,8 dBTP con techo de -1).
 */
export const LIMITER_CEILING_DBFS = TRUE_PEAK_DBTP - 0.5;
export const LIMITER_LINEAR = Math.pow(10, LIMITER_CEILING_DBFS / 20);

/** Etapa 1: loudnorm (-16 LUFS) → fundido de entrada de 500 ms. */
export function buildDecodeFilter(): string {
  return `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK_DBTP}:LRA=11,afade=t=in:st=0:d=${FADE_IN_SEC}`;
}

/** Etapa 2 (tras volumen y fundido de salida en PCM): limitador a -1 dBTP con sobremuestreo. */
export function buildLimiterFilter(): string {
  return `aresample=192000,alimiter=limit=${LIMITER_LINEAR.toFixed(6)}:level=disabled,aresample=${SAMPLE_RATE}`;
}

/** ffmpeg: entrada arbitraria (stdin) → PCM s16le normalizado. */
export function buildDecodeArgs(): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-i', 'pipe:0', '-vn',
    '-af', buildDecodeFilter(),
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    'pipe:1',
  ];
}

/** ffmpeg: PCM s16le (stdin) → limitador → Opus en Ogg con tasa min(96, máximo del canal). */
export function buildEncodeArgs(channelMaxKbps: number): string[] {
  const kbps = selectOpusBitrate(channelMaxKbps);
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0',
    '-af', buildLimiterFilter(),
    '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on',
    '-f', 'ogg', 'pipe:1',
  ];
}
