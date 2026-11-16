import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AudioError } from '../../src/audio/errors.js';
import type { PipelineHandle, PipelineRequest } from '../../src/audio/audioPipeline.js';
import { FakeClock } from '../../src/core/clock.js';
import { ok, err } from '../../src/core/result.js';
import type { Track } from '../../src/core/types.js';
import {
  GuildPlayer,
  type PlayerNotice,
  type VoiceSession,
  type VoiceSessionListener,
} from '../../src/player/index.js';

const track = (id: string, title = id): Track => ({
  id, title, durationSec: 100, url: `https://y/${id}`, thumbnailUrl: 't', requestedBy: 'u',
});

class FakeSession implements VoiceSession {
  listener!: VoiceSessionListener;
  destroyed = false;
  played = 0;
  paused = false;
  humans = 1;
  reconnectResults: boolean[] = [];
  constructor(public channelId: string) {}
  channelBitrateKbps = 64;
  humanCount() { return this.humans; }
  setListener(l: VoiceSessionListener) { this.listener = l; }
  play() { this.played++; }
  pause() { this.paused = true; }
  unpause() { this.paused = false; }
  stopOutput() {}
  async reconnect() { return this.reconnectResults.shift() ?? false; }
  destroy() { this.destroyed = true; }
}

function setup(opts: { failIds?: Map<string, unknown>; volume?: number; saveOk?: boolean; perms?: { connect: boolean; speak: boolean } } = {}) {
  const clock = new FakeClock(0);
  const notices: PlayerNotice[] = [];
  const sessions: FakeSession[] = [];
  const requests: PipelineRequest[] = [];
  const saved: number[] = [];
  const player = new GuildPlayer({
    guildId: 'g',
    clock,
    notifier: { notify: (n) => notices.push(n) },
    store: {
      getVolume: () => opts.volume ?? 50,
      setVolume: (_g, v) => {
        saved.push(v);
        return opts.saveOk === false ? err({ kind: 'save_failed' as const, message: 'x' }) : ok(undefined);
      },
    },
    connector: {
      checkPermissions: () => opts.perms ?? { connect: true, speak: true },
      connect: async (id) => {
        const s = new FakeSession(id);
        sessions.push(s);
        return s;
      },
    },
    pipelines: {
      start: async (req) => {
        requests.push(req);
        const failure = [...(opts.failIds ?? [])].find(([id]) => req.url.endsWith(id));
        if (failure) throw failure[1];
        const stream = new PassThrough();
        const h: PipelineHandle = {
          stream,
          setVolume: () => undefined,
          pause: async () => undefined,
          resume: () => undefined,
          fadeOutAndStop: async () => undefined,
          destroy: () => undefined,
          failed: new Promise<never>(() => undefined),
        };
        return h;
      },
    },
  });
  return { player, clock, notices, sessions, requests, saved };
}

describe('GuildPlayer', () => {
  it('rechaza /play sin canal de voz y no modifica la Cola', async () => {
    const { player } = setup();
    const r = await player.enqueue([track('a')], null);
    expect(r).toEqual({ ok: false, error: { reason: 'not_in_voice' } });
    expect(player.queue.pending).toHaveLength(0);
  });

  it('informa el permiso faltante', async () => {
    const { player } = setup({ perms: { connect: true, speak: false } });
    const r = await player.enqueue([track('a')], 'v1');
    expect(r).toEqual({ ok: false, error: { reason: 'missing_permission', permission: 'Speak' } });
    expect(player.queue.current).toBeNull();
  });

  it('inicia con la cola vacía, aplica el volumen guardado y encola con posición', async () => {
    const { player, requests } = setup({ volume: 70 });
    const r1 = await player.enqueue([track('a')], 'v1');
    expect(r1.ok && r1.value.startedPlayback).toBe(true);
    expect(requests[0]?.volume).toBe(70);
    const r2 = await player.enqueue([track('b')], 'v1');
    expect(r2.ok && r2.value.position).toBe(1);
    expect(player.state).toBe('reproduciendo');
  });

  it('rechaza otro canal mientras reproduce', async () => {
    const { player } = setup();
    await player.enqueue([track('a')], 'v1');
    const r = await player.enqueue([track('b')], 'v2');
    expect(r).toEqual({ ok: false, error: { reason: 'different_channel', channelId: 'v1' } });
    expect(player.queue.pending).toHaveLength(0);
  });

  it('pause/resume/skip sin reproducción devuelven nothing_playing', async () => {
    const { player } = setup();
    expect((await player.pause('v1')).ok).toBe(false);
    const r = await player.skip('v1');
    expect(r).toEqual({ ok: false, error: { reason: 'nothing_playing' } });
    expect(player.nowPlaying()).toEqual({ ok: false, error: { reason: 'nothing_playing' } });
  });

  it('pausa y reanuda conservando la posición', async () => {
    const { player, clock } = setup();
    await player.enqueue([track('a')], 'v1');
    clock.advance(5000);
    await player.pause('v1');
    clock.advance(20000);
    expect(player.state).toBe('pausado');
    expect(Math.floor(player.positionMs() / 1000)).toBe(5);
    await player.resume('v1');
    clock.advance(2000);
    expect(Math.floor(player.positionMs() / 1000)).toBe(7);
  });

  it('skip pasa a la siguiente; sin pendientes queda inactivo y conecta', async () => {
    const { player, sessions } = setup();
    await player.enqueue([track('a'), track('b')], 'v1');
    const r = await player.skip('v1');
    expect(r.ok && r.value.next?.id).toBe('b');
    const r2 = await player.skip('v1');
    expect(r2.ok && r2.value.next).toBeNull();
    expect(player.state).toBe('inactivo');
    expect(player.connected).toBe(true);
    expect(sessions[0]?.destroyed).toBe(false);
  });

  it('omite pistas fallidas con aviso y mantiene la conexión al vaciarse la cola', async () => {
    const failIds = new Map<string, unknown>([
      ['b', new AudioError('download_failed', 'x')],
      ['c', { reason: 'age_restricted' }],
    ]);
    const { player, notices, sessions } = setup({ failIds });
    await player.enqueue([track('a'), track('b', 'Bee'), track('c', 'Cee')], 'v1');
    sessions[0]?.listener.onTrackEnd();
    await Promise.resolve();
    await Promise.resolve();
    expect(notices).toContainEqual({ type: 'track_failed', title: 'Bee', reason: 'download_failed' });
    expect(notices).toContainEqual({ type: 'track_failed', title: 'Cee', reason: 'age_restricted' });
    expect(notices).toContainEqual({ type: 'queue_finished' });
    expect(player.state).toBe('inactivo');
    expect(sessions[0]?.destroyed).toBe(false);
  });

  it('stop vacía la cola y se desconecta', async () => {
    const { player, sessions } = setup();
    await player.enqueue([track('a'), track('b')], 'v1');
    await player.stop('v1');
    expect(player.queue.pending).toHaveLength(0);
    expect(sessions[0]?.destroyed).toBe(true);
    expect(player.connected).toBe(false);
  });

  it('valida loop y volumen; informa si no se guardó', async () => {
    const { player, saved } = setup({ saveOk: false });
    expect(player.setLoop('v1', 'queue')).toEqual({ ok: true, value: 'queue' });
    const bad = player.setLoop('v1', 'x');
    expect(bad.ok).toBe(false);
    expect(player.setVolume('v1', '150').ok).toBe(false);
    const v = player.setVolume('v1', 30);
    expect(v).toEqual({ ok: true, value: { volume: 30, saved: false } });
    expect(saved).toEqual([30]);
    expect(player.getVolume()).toBe(30);
  });

  it('se desconecta tras 300 s con la cola vacía', async () => {
    const { player, clock, sessions, notices } = setup();
    await player.enqueue([track('a')], 'v1');
    sessions[0]?.listener.onTrackEnd();
    clock.advance(299_000);
    expect(player.connected).toBe(true);
    clock.advance(1_000);
    expect(player.connected).toBe(false);
    expect(notices).toContainEqual({ type: 'disconnected', reason: 'idle' });
  });

  it('destruye la sesión tras fallar la reconexión y conserva la cola', async () => {
    const { player, sessions, notices, clock } = setup();
    await player.enqueue([track('a'), track('b')], 'v1');
    sessions[0]?.listener.onInterrupted();
    expect(player.state).toBe('reconectando');
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setImmediate(r));
      clock.advance(1000);
    }
    expect(player.state).toBe('sesion_destruida');
    expect(notices).toContainEqual({ type: 'session_destroyed' });
    expect(player.queue.pending).toHaveLength(1);
  });
});
