import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';
import type { Clock } from '../core/clock.js';
import { buildDecodeArgs, buildEncodeArgs } from './ffmpegArgs.js';
import { AudioError } from './errors.js';
import {
  OUT_FADE_MS,
  PAUSE_FADE_MS,
  PcmGainProcessor,
  PcmGainTransform,
  SAMPLE_RATE,
} from './pcmTransformer.js';
import { withDownloadRetries } from './retry.js';

export type SpawnFn = (cmd: string, args: string[]) => ChildProcess;

/** Abre el origen de audio de una URL; debe rechazar si la descarga falla. */
export type OpenSource = (url: string) => Promise<Readable>;

export interface AudioPipelineOptions {
  clock: Clock;
  spawn?: SpawnFn;
  openSource?: OpenSource;
  ffmpegPath?: string;
  ytDlpPath?: string;
}

export interface PipelineRequest {
  url: string;
  durationSec: number;
  /** Volumen inicial 0..100. */
  volume: number;
  /** Tasa de bits máxima del canal de voz (kbps). */
  channelMaxKbps: number;
}

export interface PipelineHandle {
  /** Flujo Ogg/Opus listo para `StreamType.OggOpus`. */
  stream: Readable;
  /** Cambio de volumen en vivo con rampa de 300 ms. */
  setVolume(v: number): void;
  /** Fundido de 200 ms a silencio; resuelve cuando es seguro detener la salida. */
  pause(): Promise<void>;
  resume(): void;
  /** Fundido de salida de 500 ms (skip/stop); resuelve al terminar. */
  fadeOutAndStop(): Promise<void>;
  destroy(): void;
  /** Se rechaza con `AudioError('ffmpeg_failed')` si ffmpeg falla. */
  readonly failed: Promise<never>;
}

export class AudioPipeline {
  private readonly spawn: SpawnFn;
  private readonly openSource: OpenSource;
  private readonly ffmpeg: string;

  constructor(private readonly opts: AudioPipelineOptions) {
    this.spawn = opts.spawn ?? ((c, a) => nodeSpawn(c, a, { stdio: ['pipe', 'pipe', 'pipe'] }));
    this.ffmpeg = opts.ffmpegPath ?? 'ffmpeg';
    this.openSource = opts.openSource ?? ((url) => this.openWithYtDlp(url));
  }

  /** Descarga con 3 reintentos separados 2 s y arranca la cadena ffmpeg. */
  async start(req: PipelineRequest): Promise<PipelineHandle> {
    const dl = await withDownloadRetries(() => this.openSource(req.url), this.opts.clock);
    if (!dl.ok) throw dl.error;
    return this.build(dl.value, req);
  }

  private build(source: Readable, req: PipelineRequest): PipelineHandle {
    const decoder = this.spawn(this.ffmpeg, buildDecodeArgs());
    const encoder = this.spawn(this.ffmpeg, buildEncodeArgs(req.channelMaxKbps));
    const processor = new PcmGainProcessor(req.volume);
    const gain = new PcmGainTransform(processor);
    const out = new PassThrough();
    const fadeEndFrame = Math.max(0, Math.round(req.durationSec * SAMPLE_RATE) - (OUT_FADE_MS * SAMPLE_RATE) / 1000);
    if (req.durationSec > 0) processor.scheduleFadeOut(fadeEndFrame, OUT_FADE_MS);

    let rejectFailed!: (e: AudioError) => void;
    const failed = new Promise<never>((_, rej) => {
      rejectFailed = rej;
    });
    failed.catch(() => undefined);
    let finished = false;

    const fail = (what: string, cause?: unknown) => {
      if (finished) return;
      finished = true;
      rejectFailed(new AudioError('ffmpeg_failed', `ffmpeg falló (${what})`, cause));
      destroy();
    };
    const destroy = () => {
      source.destroy();
      decoder.kill('SIGKILL');
      encoder.kill('SIGKILL');
      gain.destroy();
      out.destroy();
    };

    for (const [name, p] of [['decodificación', decoder], ['codificación', encoder]] as const) {
      p.on('error', (e) => fail(name, e));
      p.on('close', (code) => {
        if (code !== 0 && code !== null) fail(`${name}, código ${code}`);
      });
      p.stdin?.on('error', () => undefined);
    }
    source.on('error', (e) => fail('origen', e));

    if (!decoder.stdin || !decoder.stdout || !encoder.stdin || !encoder.stdout) {
      fail('sin flujos estándar');
    } else {
      source.pipe(decoder.stdin);
      decoder.stdout.pipe(gain).pipe(encoder.stdin);
      encoder.stdout.pipe(out);
    }

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        this.opts.clock.setTimeout(resolve, ms);
      });

    return {
      stream: out,
      failed,
      setVolume: (v) => processor.setVolume(v),
      pause: async () => {
        processor.fadeOut(PAUSE_FADE_MS);
        await wait(PAUSE_FADE_MS);
      },
      resume: () => processor.fadeIn(PAUSE_FADE_MS),
      fadeOutAndStop: async () => {
        processor.fadeOut(OUT_FADE_MS);
        await wait(OUT_FADE_MS);
        finished = true;
        destroy();
      },
      destroy: () => {
        finished = true;
        destroy();
      },
    };
  }

  /**
   * yt-dlp → stdout. Resuelve con el primer dato recibido; rechaza si termina sin datos o con error.
   * Un fallo a mitad de la descarga (p. ej. YouTube corta la conexión) se emite como error del flujo,
   * que `build` convierte en fallo de la Pista: se avisa y se pasa a la siguiente, sin tumbar el proceso.
   */
  private openWithYtDlp(url: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const p = this.spawn(this.opts.ytDlpPath ?? 'yt-dlp', [
        '-q', '--no-warnings', '-f', 'bestaudio/best', '-o', '-', url,
      ]);
      const stdout = p.stdout;
      if (!stdout) {
        reject(new Error('yt-dlp sin stdout'));
        return;
      }
      let settled = false;
      let killedByUs = false;
      let stderrTail = '';
      p.stderr?.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-1000);
      });
      p.stderr?.on('error', () => undefined);
      stdout.on('error', () => undefined);
      p.stdin?.on('error', () => undefined);

      const pass = new PassThrough();
      // Siempre hay un oyente: un error tardío nunca debe convertirse en excepción no capturada.
      pass.on('error', () => undefined);

      const failWith = (e: Error) => {
        if (!settled) {
          settled = true;
          reject(e);
        } else if (!pass.destroyed) {
          pass.destroy(e);
        }
      };
      p.on('error', (e) => failWith(e));
      p.on('close', (code) => {
        if (killedByUs || code === 0 || code === null) {
          if (!settled) failWith(new Error('yt-dlp no produjo datos'));
          return;
        }
        const detalle = stderrTail.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
        failWith(new Error(`yt-dlp terminó con código ${code}${detalle ? `: ${detalle}` : ''}`));
      });
      stdout.once('data', (first: Buffer) => {
        if (settled) return;
        settled = true;
        pass.write(first);
        stdout.pipe(pass);
        pass.on('close', () => {
          if (p.exitCode === null) {
            killedByUs = true;
            p.kill('SIGKILL');
          }
        });
        resolve(pass);
      });
    });
  }
}
