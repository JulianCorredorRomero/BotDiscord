import { describe, expect, it } from 'vitest';
import { FakeClock } from '../core/clock.js';
import { buildEncodeArgs, buildDecodeFilter, buildLimiterFilter, LIMITER_LINEAR } from './ffmpegArgs.js';
import { PcmGainProcessor } from './pcmTransformer.js';
import { withDownloadRetries } from './retry.js';

function pcm(frames: number, value = 10000): Buffer {
  const b = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames * 2; i++) b.writeInt16LE(value, i * 2);
  return b;
}

describe('withDownloadRetries', () => {
  it('reintenta 3 veces cada 2 s y tiene éxito en el cuarto intento', async () => {
    const clock = new FakeClock();
    let calls = 0;
    const p = withDownloadRetries(async () => {
      if (++calls <= 3) throw new Error('x');
      return 'ok';
    }, clock);
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(1999);
      expect(calls).toBe(i + 1);
      clock.advance(1);
    }
    const r = await p;
    expect(r.ok).toBe(true);
    expect(calls).toBe(4);
  });

  it('devuelve error tipado tras 4 fallos', async () => {
    const clock = new FakeClock();
    const p = withDownloadRetries(async () => {
      throw new Error('x');
    }, clock);
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setImmediate(r));
      clock.advance(2000);
    }
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('download_failed');
  });
});

describe('PcmGainProcessor', () => {
  it('aplica rampa de volumen de 300 ms (14400 fotogramas a 48 kHz)', () => {
    const p = new PcmGainProcessor(0);
    p.setVolume(100);
    const out = p.process(pcm(14400));
    expect(out.readInt16LE(0)).toBe(0);
    expect(out.readInt16LE((14400 - 1) * 4)).toBe(10000);
    expect(p.currentVolume).toBe(100);
  });

  it('fundido de pausa de 200 ms llega a silencio y reanuda', () => {
    const p = new PcmGainProcessor(100);
    p.fadeOut(200);
    const out = p.process(pcm(9600));
    expect(out.readInt16LE((9600 - 1) * 4)).toBe(0);
    expect(p.isSilent).toBe(true);
    p.fadeIn(200);
    const back = p.process(pcm(9600));
    expect(back.readInt16LE((9600 - 1) * 4)).toBe(10000);
  });

  it('fundido de salida programado', () => {
    const p = new PcmGainProcessor(100);
    p.scheduleFadeOut(1000, 500);
    const out = p.process(pcm(1000 + 24000));
    expect(out.readInt16LE(999 * 4)).toBe(10000);
    expect(out.readInt16LE((25000 - 1) * 4)).toBe(0);
  });
});

describe('ffmpegArgs', () => {
  it('usa loudnorm -16, fundido 500 ms y limitador -1 dBTP', () => {
    expect(buildDecodeFilter()).toContain('I=-16');
    expect(buildDecodeFilter()).toContain('afade=t=in:st=0:d=0.5');
    expect(buildLimiterFilter()).toContain('limit=' + LIMITER_LINEAR.toFixed(6));
  });
  it('tasa Opus = min(96, máximo del canal)', () => {
    expect(buildEncodeArgs(128)).toContain('96k');
    expect(buildEncodeArgs(64)).toContain('64k');
  });
});
