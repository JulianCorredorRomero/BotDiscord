import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { PipelineHandle, PipelineRequest } from '../../src/audio/audioPipeline.js';
import { startBot, type BotClientPort, type RestPort } from '../../src/bootstrap.js';
import { FakeClock } from '../../src/core/clock.js';
import { loadConfig } from '../../src/core/config.js';
import { I18n } from '../../src/core/i18n.js';
import { Logger } from '../../src/core/logger.js';
import { err, ok } from '../../src/core/result.js';
import type { Track } from '../../src/core/types.js';
import { registerCommands } from '../../src/discord/commands/index.js';
import type { InteractionContext } from '../../src/discord/guard.js';
import { InteractionRouter, type CommandHandler, type HandlerContext } from '../../src/discord/router.js';
import {
  GuildPlayer,
  PlayerManager,
  type PlayerNotice,
  type VoiceSession,
  type VoiceSessionListener,
} from '../../src/player/index.js';
import { DjService, PlaylistService, VolumeService } from '../../src/services/index.js';
import { SqliteStore, type Store } from '../../src/store/store.js';

const track = (id: string): Track => ({
  id, title: `T-${id}`, durationSec: 100, url: `https://y/${id}`, thumbnailUrl: 't', requestedBy: 'u',
});

class FakeSession implements VoiceSession {
  listener!: VoiceSessionListener;
  destroyed = false;
  reconnects = 0;
  channelBitrateKbps = 64;
  constructor(public channelId: string) {}
  humanCount() { return 1; }
  setListener(l: VoiceSessionListener) { this.listener = l; }
  play() {}
  pause() {}
  unpause() {}
  stopOutput() {}
  async reconnect() { this.reconnects++; return true; }
  destroy() { this.destroyed = true; }
}

function pipelineHandle(): PipelineHandle {
  return {
    stream: new PassThrough(),
    setVolume: () => undefined,
    pause: async () => undefined,
    resume: () => undefined,
    fadeOutAndStop: async () => undefined,
    destroy: () => undefined,
    failed: new Promise<never>(() => undefined),
  };
}

function makeEnv(store: Store) {
  const clock = new FakeClock(0);
  const notices: PlayerNotice[] = [];
  const sessions: FakeSession[] = [];
  const requests: PipelineRequest[] = [];
  const i18n = new I18n();
  const players = new PlayerManager((guildId) => ({
    guildId,
    clock,
    notifier: { notify: (n) => notices.push(n) },
    store,
    connector: {
      checkPermissions: () => ({ connect: true, speak: true }),
      connect: async (id) => {
        const s = new FakeSession(id);
        sessions.push(s);
        return s;
      },
    },
    pipelines: {
      start: async (req) => {
        requests.push(req);
        return pipelineHandle();
      },
    },
  }));
  const router = new InteractionRouter({
    guard: { check: () => ({ ok: true }) } as never,
    logger: { log: () => undefined } as never,
    i18n,
    clock,
    store,
  });
  registerCommands(router, {
    resolver: { resolve: async () => ok({ kind: 'track', track: track('a') }) },
    players,
    store,
    playlists: new PlaylistService(store, clock),
    volume: new VolumeService(store, () => undefined),
    dj: new DjService(store),
    i18n,
    rng: () => 0,
  });
  return { clock, notices, sessions, requests, i18n, players, router };
}

const handler = (router: InteractionRouter, name: string): CommandHandler =>
  (router as unknown as { handlers: Map<string, CommandHandler> }).handlers.get(name)!;

async function run(h: CommandHandler, options: Record<string, string | number | boolean> = {}): Promise<string[]> {
  const replies: string[] = [];
  const interaction: InteractionContext = {
    userId: 'u1',
    guildId: 'g1',
    commandName: 'x',
    subcommand: null,
    optionNames: Object.keys(options),
    options,
    member: { roleIds: [], isAdmin: false, voiceChannelId: 'vc1' },
    reply: async () => undefined,
    deferReply: async () => undefined,
    editReply: async () => undefined,
    followUp: async () => undefined,
  };
  const ctx: HandlerContext = { interaction, respond: async (c) => void replies.push(c) };
  await h.run(ctx);
  return replies;
}

/** Almacén real cuyo guardado de volumen siempre falla. */
function failingVolumeStore(): Store {
  const real = new SqliteStore(':memory:');
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'setVolume') return () => err({ kind: 'save_failed', message: 'disk full' });
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as Store;
}

describe('comandos sin reproducción activa (Req. 2.12)', () => {
  const names = ['pause', 'resume', 'skip', 'nowplaying'] as const;

  it('sin reproductor: cada comando responde que no hay nada reproduciéndose', async () => {
    const e = makeEnv(new SqliteStore(':memory:'));
    for (const n of names) {
      expect(await run(handler(e.router, n))).toEqual([e.i18n.t('cmd.not_playing')]);
    }
    expect(e.players.get('g1')).toBeUndefined();
    expect(e.sessions).toHaveLength(0);
  });

  it('con reproductor inactivo: responde igual y no altera el estado', async () => {
    const e = makeEnv(new SqliteStore(':memory:'));
    const p = e.players.getOrCreate('g1');
    for (const n of names) {
      expect(await run(handler(e.router, n))).toEqual([e.i18n.t('cmd.not_playing')]);
    }
    expect(p.state).toBe('inactivo');
    expect(p.queue.current).toBeNull();
    expect(p.queue.pending).toHaveLength(0);
  });

  it('/resume con la pista sonando no cambia el estado', async () => {
    const e = makeEnv(new SqliteStore(':memory:'));
    const p = e.players.getOrCreate('g1');
    await p.enqueue([track('a'), track('b')], 'vc1');
    expect(await run(handler(e.router, 'resume'))).toEqual([e.i18n.t('cmd.not_playing')]);
    expect(p.state).toBe('reproduciendo');
    expect(p.queue.pending).toHaveLength(1);
  });
});

describe('volumen (Req. 3.6, 3.8)', () => {
  it('sin valor guardado el volumen es 50 y se aplica al conectar', async () => {
    const e = makeEnv(new SqliteStore(':memory:'));
    const p = e.players.getOrCreate('g1');
    await p.enqueue([track('a')], 'vc1');
    expect(e.requests[0]?.volume).toBe(50);
    expect(p.currentVolume).toBe(50);
  });

  it('fallo al guardar con reproductor: aplica el volumen y avisa de que no se guardó', async () => {
    const e = makeEnv(failingVolumeStore());
    const p = e.players.getOrCreate('g1');
    await p.enqueue([track('a')], 'vc1');
    const replies = await run(handler(e.router, 'volume'), { value: 30 });
    expect(replies).toEqual([e.i18n.t('volume.not_saved', undefined, { volume: 30 })]);
    expect(p.currentVolume).toBe(30);
  });

  it('fallo al guardar sin reproductor: avisa de que no se guardó', async () => {
    const e = makeEnv(failingVolumeStore());
    const replies = await run(handler(e.router, 'volume'), { value: 30 });
    expect(replies).toEqual([e.i18n.t('volume.not_saved', undefined, { volume: 30 })]);
  });
});

function movePlayer() {
  const store = new SqliteStore(':memory:');
  const clock = new FakeClock(0);
  const notices: PlayerNotice[] = [];
  const sessions: FakeSession[] = [];
  const player = new GuildPlayer({
    guildId: 'g',
    clock,
    notifier: { notify: (n) => notices.push(n) },
    store,
    connector: {
      checkPermissions: () => ({ connect: true, speak: true }),
      connect: async (id) => {
        const s = new FakeSession(id);
        sessions.push(s);
        return s;
      },
    },
    pipelines: { start: async () => pipelineHandle() },
  });
  return { player, clock, notices, sessions };
}

describe('movimiento y desconexión del Bot por un moderador', () => {
  it('movido: continúa en el nuevo canal con Cola y posición conservadas (Req. 9.7)', async () => {
    const { player, clock, notices, sessions } = movePlayer();
    await player.enqueue([track('a'), track('b'), track('c')], 'v1');
    clock.advance(5_000);
    sessions[0]!.channelId = 'v2'; // la sesión ya está en el nuevo canal
    player.notifyBotChannelChange('v1', 'v2');
    clock.advance(1_000);
    expect(notices).toContainEqual({ type: 'moved', channelId: 'v2' });
    expect(player.state).toBe('reproduciendo');
    expect(player.voiceChannelId).toBe('v2');
    expect(player.queue.current?.id).toBe('a');
    expect(player.queue.pending.map((t) => t.id)).toEqual(['b', 'c']);
    expect(player.positionMs()).toBe(6_000);
    expect(sessions[0]!.destroyed).toBe(false);
  });

  it('desconectado: detiene, vacía la Cola y no reconecta (Req. 9.8)', async () => {
    const { player, clock, sessions } = movePlayer();
    await player.enqueue([track('a'), track('b')], 'v1');
    player.notifyBotChannelChange('v1', null);
    clock.advance(60_000);
    expect(player.state).toBe('inactivo');
    expect(player.queue.current).toBeNull();
    expect(player.queue.pending).toHaveLength(0);
    expect(player.connected).toBe(false);
    expect(sessions[0]!.destroyed).toBe(true);
    expect(sessions[0]!.reconnects).toBe(0);
    expect(sessions).toHaveLength(1);
  });
});

describe('registro de slash commands al arrancar (Req. 9.9, 9.10)', () => {
  const TOKEN = 'SUPER.secret.TOKEN-123456';
  const CLIENT_ID = '987654321098765432';

  async function settle(): Promise<void> {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  async function boot(failures: number) {
    const clock = new FakeClock(0);
    const bodies: unknown[] = [];
    const times: number[] = [];
    const rest: RestPort = {
      put: async (_route, o) => {
        times.push(clock.now());
        bodies.push(o.body);
        if (times.length <= failures) throw new Error('HTTP 503');
        return [];
      },
    };
    const client = {
      on: () => client,
      login: async () => 'ok',
      destroy: async () => undefined,
      user: { id: 'bot' },
      channels: { fetch: async () => null },
    } as unknown as BotClientPort;
    const cfg = loadConfig({ DISCORD_TOKEN: TOKEN, DISCORD_CLIENT_ID: CLIENT_ID });
    if (!cfg.ok) throw new Error('config');
    const handle = await startBot({
      config: cfg.value,
      client,
      rest,
      clock,
      logger: new Logger([TOKEN], () => undefined),
      store: new SqliteStore(':memory:'),
      resolver: { resolve: async () => err('no_results' as const), searchSuggestions: async () => [] },
      audio: { start: async () => { throw new Error('no audio'); } },
      connectorFor: () => { throw new Error('no voice'); },
    });
    return { clock, handle, bodies, times };
  }

  it('registra los 13 comandos nada más iniciar sesión, sin esperar', async () => {
    const { handle, bodies, times } = await boot(0);
    await expect(handle.registration).resolves.toEqual({ ok: true, attempts: 1 });
    expect(times).toEqual([0]);
    expect((bodies[0] as unknown[]).length).toBe(13);
    await handle.stop();
  });

  it('con 3 fallos seguidos el cuarto intento ocurre a los 30 s, dentro de 60 s', async () => {
    const { clock, handle, times } = await boot(3);
    for (let i = 0; i < 3; i++) {
      await settle();
      clock.advance(10_000);
    }
    await expect(handle.registration).resolves.toEqual({ ok: true, attempts: 4 });
    expect(times).toEqual([0, 10_000, 20_000, 30_000]);
    expect(times[times.length - 1]).toBeLessThanOrEqual(60_000);
    await handle.stop();
  });
});
