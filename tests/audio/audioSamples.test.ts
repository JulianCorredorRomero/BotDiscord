import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildDecodeArgs,
  buildEncodeArgs,
  buildLimiterFilter,
  LIMIT_LINEAR,
  TARGET_LUFS,
  TRUE_PEAK_DBTP,
} from '../../src/audio/ffmpegArgs.js';
import {
  CHANNELS,
  OUT_FADE_MS,
  PAUSE_FADE_MS,
  PcmGainProcessor,
  SAMPLE_RATE,
} from '../../src/audio/pcmTransformer.js';

const ffmpegAvailable = (() => {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

// ---------- Helpers PCM (sin ffmpeg) ----------

/** PCM s16le estéreo con valor constante. */
function constantPcm(frames: number, value: number): Buffer {
  const b = Buffer.alloc(frames * CHANNELS * 2);
  for (let i = 0; i < frames * CHANNELS; i++) b.writeInt16LE(value, i * 2);
  return b;
}

/** Amplitud (canal izquierdo) por fotograma. */
function envelope(buf: Buffer): number[] {
  const out: number[] = [];
  for (let p = 0; p < buf.length; p += CHANNELS * 2) out.push(buf.readInt16LE(p));
  return out;
}

const msToFrames = (ms: number) => Math.round((ms * SAMPLE_RATE) / 1000);
const FULL = 20000;

describe('PcmGainProcessor: fundidos (Req 5.3, 5.4, 5.5, 5.7)', () => {
  it('fundido de salida de 500 ms: de pleno a silencio en ~500 ms', () => {
    const p = new PcmGainProcessor(100);
    p.fadeOut(OUT_FADE_MS);
    const env = envelope(p.process(constantPcm(msToFrames(1000), FULL)));
    const firstSilent = env.findIndex((v) => v === 0);
    const tol = msToFrames(10);
    expect(Math.abs(firstSilent - msToFrames(500))).toBeLessThanOrEqual(tol);
    expect(env[0]).toBeGreaterThan(FULL * 0.99);
    // Monótono decreciente
    for (let i = 1; i < env.length; i++) expect(env[i]!).toBeLessThanOrEqual(env[i - 1]!);
    expect(p.isSilent).toBe(true);
  });

  it('fundido de salida programado empieza en el fotograma indicado y dura 500 ms', () => {
    const p = new PcmGainProcessor(100);
    const at = msToFrames(300);
    p.scheduleFadeOut(at, OUT_FADE_MS);
    const env = envelope(p.process(constantPcm(msToFrames(1200), FULL)));
    expect(env[at - 1]).toBe(FULL);
    const firstSilent = env.findIndex((v) => v === 0);
    expect(Math.abs(firstSilent - (at + msToFrames(500)))).toBeLessThanOrEqual(msToFrames(10));
  });

  it('fundido de entrada de 500 ms desde silencio', () => {
    const p = new PcmGainProcessor(100, SAMPLE_RATE, CHANNELS, true);
    p.fadeIn(OUT_FADE_MS);
    const env = envelope(p.process(constantPcm(msToFrames(1000), FULL)));
    expect(env[0]).toBe(0);
    const firstFull = env.findIndex((v) => v >= FULL);
    expect(Math.abs(firstFull - msToFrames(500))).toBeLessThanOrEqual(msToFrames(10));
  });

  it('pausa (fundido a silencio) y reanudación (fundido a pleno) duran 200 ms', () => {
    const p = new PcmGainProcessor(100);
    p.fadeOut(PAUSE_FADE_MS);
    const down = envelope(p.process(constantPcm(msToFrames(500), FULL)));
    const silentAt = down.findIndex((v) => v === 0);
    expect(Math.abs(silentAt - msToFrames(200))).toBeLessThanOrEqual(msToFrames(5));

    p.fadeIn(PAUSE_FADE_MS);
    const up = envelope(p.process(constantPcm(msToFrames(500), FULL)));
    const fullAt = up.findIndex((v) => v >= FULL);
    expect(Math.abs(fullAt - msToFrames(200))).toBeLessThanOrEqual(msToFrames(5));
  });

  it('el fundido se conserva igual si el flujo llega en trozos pequeños', () => {
    const whole = new PcmGainProcessor(100);
    whole.fadeOut(OUT_FADE_MS);
    const a = whole.process(constantPcm(msToFrames(700), FULL));
    const chunked = new PcmGainProcessor(100);
    chunked.fadeOut(OUT_FADE_MS);
    const parts: Buffer[] = [];
    const total = constantPcm(msToFrames(700), FULL);
    for (let o = 0; o < total.length; o += 4 * 333) {
      parts.push(chunked.process(total.subarray(o, Math.min(total.length, o + 4 * 333))));
    }
    expect(Buffer.concat(parts).equals(a)).toBe(true);
  });
});

describe('PcmGainProcessor: ganancia con Volumen 0, 50 y 100 (Req 5.1, 5.2)', () => {
  const PEAK = 32767;
  for (const vol of [0, 50, 100]) {
    it(`volumen ${vol}: la salida nunca supera la entrada y el techo del limitador es alcanzable`, () => {
      const p = new PcmGainProcessor(vol);
      const out = envelope(p.process(constantPcm(4800, PEAK)));
      const max = Math.max(...out.map(Math.abs));
      expect(max).toBeLessThanOrEqual(PEAK);
      expect(max).toBeCloseTo(Math.round((PEAK * vol) / 100), -1);
      // La ganancia nunca amplifica: el limitador de etapa 2 solo recibe ≤ entrada.
      expect(max / PEAK).toBeLessThanOrEqual(1);
    });
  }

  it('volumen 0 produce silencio y 100 es ganancia unidad', () => {
    const zero = envelope(new PcmGainProcessor(0).process(constantPcm(100, 12345)));
    expect(zero.every((v) => v === 0)).toBe(true);
    const unity = envelope(new PcmGainProcessor(100).process(constantPcm(100, 12345)));
    expect(unity.every((v) => v === 12345)).toBe(true);
  });

  it('el volumen se interpola en una rampa de 300 ms', () => {
    const p = new PcmGainProcessor(0);
    p.setVolume(100);
    const env = envelope(p.process(constantPcm(msToFrames(600), FULL)));
    const fullAt = env.findIndex((v) => v >= FULL);
    expect(Math.abs(fullAt - msToFrames(300))).toBeLessThanOrEqual(msToFrames(5));
  });
});

describe('Argumentos de ffmpeg (Req 5.1, 5.2, 5.3)', () => {
  it('la etapa de decodificación normaliza a -16 LUFS / -1 dBTP con fundido de 500 ms', () => {
    const af = buildDecodeArgs()[buildDecodeArgs().indexOf('-af') + 1]!;
    expect(af).toContain(`I=${TARGET_LUFS}`);
    expect(af).toContain(`TP=${TRUE_PEAK_DBTP}`);
    expect(af).toContain('afade=t=in:st=0:d=0.5');
  });

  it('la etapa de codificación aplica un limitador a -1 dBTP con sobremuestreo', () => {
    expect(LIMIT_LINEAR).toBeCloseTo(0.891251, 5);
    expect(buildLimiterFilter()).toContain('alimiter=limit=0.891251');
    expect(buildLimiterFilter()).toContain('aresample=192000');
    expect(buildEncodeArgs(128)).toContain(buildLimiterFilter());
  });
});

// ---------- Medición real con ffmpeg ----------

function ff(args: string[], input?: Buffer) {
  const r = spawnSync('ffmpeg', args, { input, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg falló: ${r.stderr?.toString()}`);
  return r;
}

/** Genera 15 s de ruido rosa estéreo como WAV en memoria. */
function sampleWav(): Buffer {
  return ff([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anoisesrc=d=15:c=pink:a=0.5:r=48000',
    '-ac', '2', '-f', 'wav', 'pipe:1',
  ]).stdout as Buffer;
}

function decodeToPcm(wav: Buffer): Buffer {
  return ff(buildDecodeArgs(), wav).stdout as Buffer;
}

function measure(pcm: Buffer): { lufs: number; truePeak: number } {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-nostats',
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0',
      '-af', 'ebur128=peak=true', '-f', 'null', '-',
    ],
    { input: pcm, maxBuffer: 256 * 1024 * 1024 },
  );
  const text = r.stderr.toString();
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const lufs = Number(/I:\s+(-?[\d.]+)\s+LUFS/.exec(summary)?.[1]);
  const truePeak = Number(/Peak:\s+(-?[\d.]+)\s+dBFS/.exec(summary)?.[1]);
  return { lufs, truePeak };
}

/** Pasa PCM por la etapa 2 (limitador) y devuelve PCM s16le decodificado. */
function limitOnly(pcm: Buffer): Buffer {
  return ff(
    [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0',
      '-af', buildLimiterFilter(),
      '-f', 's16le', 'pipe:1',
    ],
    pcm,
  ).stdout as Buffer;
}

describe.skipIf(!ffmpegAvailable)('Audio real con ffmpeg (Req 5.1, 5.2, 5.3)', () => {
  const wav = ffmpegAvailable ? sampleWav() : Buffer.alloc(0);
  const decoded = ffmpegAvailable ? decodeToPcm(wav) : Buffer.alloc(0);

  it('la sonoridad integrada tras la decodificación es -16 LUFS ±1 LU', () => {
    const { lufs } = measure(decoded);
    expect(Math.abs(lufs - TARGET_LUFS)).toBeLessThanOrEqual(1);
  });

  for (const vol of [0, 50, 100]) {
    it(`techo de -1 dBTP con Volumen ${vol}`, () => {
      const p = new PcmGainProcessor(vol);
      const scaled = p.process(decoded);
      // Se amplifica en la prueba para forzar al limitador (+12 dB sobre el nivel normalizado).
      const hot = ff(
        [
          '-hide_banner', '-loglevel', 'error', '-nostdin',
          '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0',
          '-af', 'volume=12dB', '-f', 's16le', 'pipe:1',
        ],
        scaled,
      ).stdout as Buffer;
      const limited = limitOnly(hot);
      if (vol === 0) {
        expect(limited.every((b) => b === 0)).toBe(true);
        return;
      }
      const { truePeak } = measure(limited);
      expect(truePeak).toBeLessThanOrEqual(TRUE_PEAK_DBTP + 0.1);
    });
  }

  it('el fundido de entrada dura 500 ms', () => {
    const env = envelope(decoded.subarray(0, msToFrames(1000) * 4));
    const rms = (a: number, b: number) =>
      Math.sqrt(env.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    expect(rms(0, msToFrames(20))).toBeLessThan(rms(msToFrames(480), msToFrames(500)));
    const steady = rms(msToFrames(600), msToFrames(900));
    expect(rms(msToFrames(480), msToFrames(500))).toBeGreaterThan(steady * 0.5);
    expect(rms(0, msToFrames(20))).toBeLessThan(steady * 0.1);
  });
});
