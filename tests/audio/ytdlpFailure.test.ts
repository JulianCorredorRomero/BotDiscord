import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AudioPipeline } from '../../src/audio/audioPipeline.js';
import { FakeClock } from '../../src/core/clock.js';

/** Proceso hijo falso: stdout/stderr/stdin controlables. */
function fakeProc() {
  const p = new EventEmitter() as EventEmitter & {
    stdout: PassThrough; stderr: PassThrough; stdin: PassThrough;
    exitCode: number | null; killed: boolean; kill(sig?: string): boolean;
  };
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.stdin = new PassThrough();
  p.exitCode = null;
  p.killed = false;
  p.kill = () => {
    p.killed = true;
    if (p.exitCode === null) setImmediate(() => p.emit('close', null, 'SIGKILL'));
    return true;
  };
  return p;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('yt-dlp falla a mitad de la canción', () => {
  it('no lanza una excepción no capturada: la Pista falla y el proceso sigue', async () => {
    const procs: ReturnType<typeof fakeProc>[] = [];
    const spawn = (() => {
      const p = fakeProc();
      procs.push(p);
      return p as unknown as ChildProcess;
    });
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      const pipeline = new AudioPipeline({ clock: new FakeClock(), spawn });
      const started = pipeline.start({ url: 'https://youtu.be/x', durationSec: 100, volume: 50, channelMaxKbps: 64 });
      await tick();
      const ytdlp = procs[0]!;
      ytdlp.stdout.write(Buffer.alloc(1024));
      const handle = await started;
      const failed = handle.failed.then(() => 'ok', (e: Error) => e.message);

      // YouTube corta la descarga: yt-dlp escribe un error y termina con código 1.
      ytdlp.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden\n');
      await tick();
      ytdlp.exitCode = 1;
      ytdlp.emit('close', 1, null);
      await tick();
      await tick();

      expect(await failed).toContain('origen');
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('un error de yt-dlp antes de recibir datos rechaza la descarga e incluye el motivo', async () => {
    const procs: ReturnType<typeof fakeProc>[] = [];
    const spawn = (() => {
      const p = fakeProc();
      procs.push(p);
      queueMicrotask(() => {
        p.stderr.write('ERROR: Video unavailable\n');
        setImmediate(() => {
          p.exitCode = 1;
          p.emit('close', 1, null);
        });
      });
      return p as unknown as ChildProcess;
    });
    const clock = new FakeClock();
    const pipeline = new AudioPipeline({ clock, spawn });
    const started = pipeline.start({ url: 'https://youtu.be/x', durationSec: 100, volume: 50, channelMaxKbps: 64 });
    const result = started.then(() => null, (e: unknown) => e);
    for (let i = 0; i < 4; i++) {
      await tick(); await tick();
      clock.advance(2000);
    }
    expect(await result).toMatchObject({ kind: 'download_failed' });
    expect(procs.length).toBe(4);
  });
});
