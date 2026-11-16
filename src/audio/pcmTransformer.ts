import { Transform, type TransformCallback } from 'node:stream';
import { clampVolume, volumeRamp } from '../core/volume-format.js';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const BYTES_PER_FRAME = CHANNELS * 2; // s16le

export const VOLUME_RAMP_MS = 300;
export const PAUSE_FADE_MS = 200;
export const OUT_FADE_MS = 500;

/** Nivel (0..100) que sigue una rampa lineal precalculada con `volumeRamp`. */
class Ramper {
  private ramp: number[] = [];
  private idx = 0;
  level: number;

  constructor(
    initial: number,
    private readonly sampleRate: number,
  ) {
    this.level = clampVolume(initial);
  }

  rampTo(target: number, durationMs: number): void {
    const t = clampVolume(target);
    this.ramp = volumeRamp(this.level, t, durationMs, this.sampleRate);
    this.idx = 0;
    if (this.ramp.length === 0) this.level = t;
  }

  get target(): number {
    return this.ramp.length > 0 ? (this.ramp[this.ramp.length - 1] as number) * 100 : this.level;
  }

  /** Ganancia (0..1) para el siguiente fotograma. */
  next(): number {
    if (this.idx < this.ramp.length) {
      this.level = (this.ramp[this.idx++] as number) * 100;
      if (this.idx >= this.ramp.length) this.ramp = [];
    }
    return this.level / 100;
  }
}

/**
 * Procesador puro de PCM s16le entrelazado: aplica ganancia de volumen (rampa lineal
 * de 300 ms) multiplicada por un fundido independiente (pausa/reanudación 200 ms,
 * salida 500 ms). No depende de ffmpeg.
 */
export class PcmGainProcessor {
  private readonly volume: Ramper;
  private readonly fade: Ramper;

  constructor(
    initialVolume: number,
    private readonly sampleRate = SAMPLE_RATE,
    private readonly channels = CHANNELS,
    startSilent = false,
  ) {
    this.volume = new Ramper(initialVolume, sampleRate);
    this.fade = new Ramper(startSilent ? 0 : 100, sampleRate);
  }

  get frameBytes(): number {
    return this.channels * 2;
  }

  get currentVolume(): number {
    return this.volume.level;
  }

  get currentFade(): number {
    return this.fade.level;
  }

  setVolume(v: number, durationMs = VOLUME_RAMP_MS): void {
    this.volume.rampTo(v, durationMs);
  }

  /** Fundido a silencio (pausa o salida). */
  fadeOut(durationMs = PAUSE_FADE_MS): void {
    this.fade.rampTo(0, durationMs);
  }

  /** Fundido desde el nivel actual hasta el nivel pleno (reanudación o entrada). */
  fadeIn(durationMs = PAUSE_FADE_MS): void {
    this.fade.rampTo(100, durationMs);
  }

  private framesDone = 0;
  private scheduledOut: { atFrame: number; ms: number } | null = null;

  /** Programa un fundido de salida que empieza en el fotograma `atFrame` (desde el inicio del flujo). */
  scheduleFadeOut(atFrame: number, durationMs = OUT_FADE_MS): void {
    this.scheduledOut = { atFrame: Math.max(0, atFrame), ms: durationMs };
  }

  /** True si el fundido ya llegó a silencio y no hay rampa pendiente. */
  get isSilent(): boolean {
    return this.fade.level === 0 && this.fade.target === 0;
  }

  /** Procesa fotogramas completos; `input.length` debe ser múltiplo de `frameBytes`. */
  process(input: Buffer): Buffer {
    const out = Buffer.allocUnsafe(input.length);
    const ch = this.channels;
    const frames = Math.floor(input.length / (ch * 2));
    let pos = 0;
    for (let f = 0; f < frames; f++) {
      if (this.scheduledOut && this.framesDone >= this.scheduledOut.atFrame) {
        this.fade.rampTo(0, this.scheduledOut.ms);
        this.scheduledOut = null;
      }
      this.framesDone++;
      const g = this.volume.next() * this.fade.next();
      for (let c = 0; c < ch; c++) {
        const s = input.readInt16LE(pos);
        const v = Math.max(-32768, Math.min(32767, Math.round(s * g)));
        out.writeInt16LE(v, pos);
        pos += 2;
      }
    }
    return out;
  }
}

/** Transform de Node que aplica `PcmGainProcessor`, conservando fotogramas parciales entre trozos. */
export class PcmGainTransform extends Transform {
  private carry: Buffer = Buffer.alloc(0);

  constructor(readonly processor: PcmGainProcessor) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    const data = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    const usable = data.length - (data.length % this.processor.frameBytes);
    this.carry = Buffer.from(data.subarray(usable));
    if (usable > 0) this.push(this.processor.process(data.subarray(0, usable)));
    cb();
  }
}
