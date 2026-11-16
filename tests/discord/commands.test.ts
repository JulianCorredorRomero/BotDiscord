import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { PipelineHandle } from '../../src/audio/audioPipeline.js';
import { FakeClock } from '../../src/core/clock.js';
import { I18n } from '../../src/core/i18n.js';
import { err, ok, type Result } from '../../src/core/result.js';
import type { Track } from '../../src/core/types.js';
import { buildCommandDefinitions } from '../../src/discord/commandDefinitions.js';
import { registerCommands, type CommandDeps } from '../../src/discord/commands/index.js';
import type { InteractionContext } from '../../src/discord/guard.js';
import { InteractionRouter, type CommandHandler, type HandlerContext } from '../../src/discord/router.js';
import { PlayerManager, type VoiceSession } from '../../src/player/index.js';
import type { ResolveError, ResolveResult } from '../../src/resolver/resolver.js';
import { DjService, PlaylistService, VolumeService } from '../../src/services/index.js';
import { SqliteStore } from '../../src/store/store.js';

const track = (id: string): Track => ({
  id, title: `T-${id}`, durationSec: 100, url: `https://y/${id}`, thumbnailUrl: 't', requestedBy: 'u',
});

class FakeSession implements VoiceSession {
  channelBitrateKbps = 64;
  constructor(public channelId: string) {}
  humanCount() { return 1; }
  setListener() {}
  play() {}
  pause() {}
  unpause() {}
  stopOutput() {}
  async reconnect() { return true; }
  destroy() {}
}

function setup(opts: { resolve?: Result<ResolveResult, ResolveError>; perms?: { connect: boolean; speak: boolean } } = {}) {
  const clock = new FakeClock(0);
  const store = new SqliteStore(':memory:');
  const i18n = new I18n();
  const resolved: string[] = [];
  const players = new PlayerManager(() => ({
    guildId: 'g1',
    clock,
    notifier: { notify: () => undefined },
    store,
    connector: {
      checkPermissions: () => opts.perms ?? { connect: true, speak: true },
      connect: async (id) => new FakeSession(id),
    },
    pipelines: {
      start: async () => {
        const h: PipelineHandle = {
          stream: new PassThrough(),
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
  }));
  const deps: CommandDeps = {
    resolver: {
      resolve: async (q) => {
        resolved.push(q);
        return opts.resolve ?? ok({ kind: 'track', track: track('a') });
      },
    },
    players,
    store,
    playlists: new PlaylistService(store, clock),
    volume: new VolumeService(store, () => undefined),
    dj: new DjService(store),
    i18n,
    rng: () => 0,
  };
  const router = new InteractionRouter({
    guard: { check: () => ({ ok: true }) } as never,
    logger: { log: () => undefined } as never,
    i18n,
    clock,
    store,
  });
  registerCommands(router, deps);
  return { deps, players, store, resolved, clock, router };
}

interface Run {
  replies: string[];
}

async function run(
  handler: CommandHandler,
  over: Partial<InteractionContext> & { options?: Record<string, string | number | boolean> } = {},
): Promise<Run> {
  const replies: string[] = [];
  const interaction: InteractionContext = {
    userId: 'u1',
    guildId: 'g1',
    commandName: 'x',
    subcommand: null,
    optionNames: Object.keys(over.options ?? {}),
    member: { roleIds: [], isAdmin: false, voiceChannelId: 'vc1' },
    reply: async () => undefined,
    deferReply: async () => undefined,
    editReply: async () => undefined,
    followUp: async () => undefined,
    ...over,
  };
  const ctx: HandlerContext = { interaction, respond: async (c) => void replies.push(c) };
  await handler.run(ctx);
  return { replies };
}

const handler = (router: InteractionRouter, name: string): CommandHandler =>
  (router as unknown as { handlers: Map<string, CommandHandler> }).handlers.get(name)!;

async function startPlaying(s: ReturnType<typeof setup>, ids: string[]) {
  const p = s.players.getOrCreate('g1');
  await p.enqueue(ids.map(track), 'vc1');
  return p;
}

describe('comandos', () => {
  describe('/play', () => {
    it('sin canal de voz: responde y no resuelve ni encola', async () => {
      const s = setup();
      const r = await run(handler(s.router, 'play'), {
        options: { query: 'x' },
        member: { roleIds: [], isAdmin: false, voiceChannelId: null },
      });
      expect(r.replies).toEqual([s.deps.i18n.t('error.not_in_voice')]);
      expect(s.resolved).toHaveLength(0);
      expect(s.players.get('g1')).toBeUndefined();
    });

    it('éxito: reproduce ahora y luego informa la posición en la cola', async () => {
      const s = setup();
      const play = handler(s.router, 'play');
      const first = await run(play, { options: { query: 'a' } });
      expect(first.replies[0]).toContain('Reproduciendo ahora: T-a');
      const second = await run(play, { options: { query: 'b' } });
      expect(second.replies[0]).toContain('posición 1');
      expect(s.players.get('g1')!.queue.pending).toHaveLength(1);
    });

    it('error del resolvedor: mensaje del motivo y Cola intacta', async () => {
      const s = setup({ resolve: err('age_restricted') });
      const r = await run(handler(s.router, 'play'), { options: { query: 'a' } });
      expect(r.replies[0]).toContain('restricción de edad');
      expect(s.players.get('g1')).toBeUndefined();
    });

    it('lista con omitidas informa añadidas y omitidas', async () => {
      const s = setup({ resolve: ok({ kind: 'playlist', tracks: [track('a'), track('b')], skipped: 3 }) });
      const r = await run(handler(s.router, 'play'), { options: { query: 'pl' } });
      expect(r.replies[0]).toContain('2 pistas');
      expect(r.replies[0]).toContain('3 omitidas');
    });

    it('permiso faltante: indica el permiso', async () => {
      const s = setup({ perms: { connect: true, speak: false } });
      const r = await run(handler(s.router, 'play'), { options: { query: 'a' } });
      expect(r.replies[0]).toContain('Speak');
      expect(s.players.get('g1')).toBeUndefined();
    });

    it('otro canal: menciona el canal en uso', async () => {
      const s = setup();
      await startPlaying(s, ['a']);
      const r = await run(handler(s.router, 'play'), {
        options: { query: 'b' },
        member: { roleIds: [], isAdmin: false, voiceChannelId: 'vc2' },
      });
      expect(r.replies[0]).toContain('<#vc1>');
    });
  });

  it('/skip sin reproducción: nada reproduciéndose', async () => {
    const s = setup();
    const r = await run(handler(s.router, 'skip'));
    expect(r.replies).toEqual([s.deps.i18n.t('cmd.not_playing')]);
  });

  it('/skip con reproducción pasa a la siguiente', async () => {
    const s = setup();
    await startPlaying(s, ['a', 'b']);
    const r = await run(handler(s.router, 'skip'));
    expect(r.replies[0]).toContain('T-b');
  });

  describe('/remove', () => {
    it('fuera de rango indica el rango válido y conserva la Cola', async () => {
      const s = setup();
      const p = await startPlaying(s, ['a', 'b', 'c']);
      const rm = handler(s.router, 'remove');
      for (const position of [0, 3, -1]) {
        const r = await run(rm, { options: { position } });
        expect(r.replies[0]).toContain('entre 1 y 2');
      }
      expect(p.queue.pending).toHaveLength(2);
    });

    it('posición válida elimina la pista', async () => {
      const s = setup();
      const p = await startPlaying(s, ['a', 'b', 'c']);
      const r = await run(handler(s.router, 'remove'), { options: { position: 1 } });
      expect(r.replies[0]).toContain('T-b');
      expect(p.queue.pending.map((t) => t.id)).toEqual(['c']);
    });
  });

  describe('/volume', () => {
    it('inválido: rango 0-100 y no cambia el valor', async () => {
      const s = setup();
      for (const value of [101, -1, 2.5]) {
        const r = await run(handler(s.router, 'volume'), { options: { value } });
        expect(r.replies[0]).toContain('entre 0 y 100');
      }
      expect(s.store.getVolume('g1')).toBe(50);
    });

    it('válido sin reproductor: aplica y guarda', async () => {
      const s = setup();
      const r = await run(handler(s.router, 'volume'), { options: { value: 80 } });
      expect(r.replies[0]).toContain('80');
      expect(s.store.getVolume('g1')).toBe(80);
    });

    it('válido con reproductor: aplica y guarda', async () => {
      const s = setup();
      const p = await startPlaying(s, ['a']);
      const r = await run(handler(s.router, 'volume'), { options: { value: 20 } });
      expect(r.replies[0]).toContain('20');
      expect(p.currentVolume).toBe(20);
      expect(s.store.getVolume('g1')).toBe(20);
    });

    it('sin valor muestra el volumen actual', async () => {
      const s = setup();
      const r = await run(handler(s.router, 'volume'));
      expect(r.replies[0]).toContain('50');
    });
  });

  it('/loop inválido: lista los modos válidos y conserva el modo', async () => {
    const s = setup();
    const p = await startPlaying(s, ['a']);
    const r = await run(handler(s.router, 'loop'), { options: { mode: 'bogus' } });
    expect(r.replies[0]).toContain('off, track, queue');
    expect(p.loop).toBe('off');
    const ok1 = await run(handler(s.router, 'loop'), { options: { mode: 'queue' } });
    expect(ok1.replies[0]).toContain('queue');
    expect(p.loop).toBe('queue');
  });

  describe('/queue', () => {
    it('vacía: mensaje de cola vacía', async () => {
      const s = setup();
      const r = await run(handler(s.router, 'queue'));
      expect(r.replies).toEqual([s.deps.i18n.t('queue.empty')]);
    });

    it('pagina de 10 en 10 con número de página', async () => {
      const s = setup();
      await startPlaying(s, Array.from({ length: 26 }, (_, i) => `t${i}`));
      const q = handler(s.router, 'queue');
      const p1 = await run(q);
      expect(p1.replies[0]).toContain('Página 1/3');
      expect(p1.replies[0]).toContain('1. T-t1 ');
      const p3 = await run(q, { options: { page: 3 } });
      expect(p3.replies[0]).toContain('Página 3/3');
      expect(p3.replies[0]).toContain('25. T-t25');
      expect(p3.replies[0]).not.toContain('10. ');
    });
  });

  describe('/playlist', () => {
    it('list vacía', async () => {
      const s = setup();
      const r = await run(handler(s.router, 'playlist'), { subcommand: 'list' });
      expect(r.replies).toEqual([s.deps.i18n.t('playlist.list_empty')]);
    });

    it('save, sobrescritura con confirmación, list, load y delete', async () => {
      const s = setup();
      await startPlaying(s, ['a', 'b']);
      const pl = handler(s.router, 'playlist');
      const saved = await run(pl, { subcommand: 'save', options: { name: 'mix' } });
      expect(saved.replies[0]).toContain('2 pistas');
      const again = await run(pl, { subcommand: 'save', options: { name: 'mix' } });
      expect(again.replies[0]).toContain('confirm:true');
      const cancelled = await run(pl, { subcommand: 'save', options: { name: 'mix', confirm: false } });
      expect(cancelled.replies[0]).toContain('cancelada');
      const list = await run(pl, { subcommand: 'list' });
      expect(list.replies[0]).toContain('mix (2 pistas)');
      const missing = await run(pl, { subcommand: 'load', options: { name: 'nope' } });
      expect(missing.replies[0]).toContain('no existe');
      const loaded = await run(pl, { subcommand: 'load', options: { name: 'mix' } });
      expect(loaded.replies[0]).toContain('2 pistas añadidas');
      const del = await run(pl, { subcommand: 'delete', options: { name: 'mix' } });
      expect(del.replies[0]).toContain('eliminada');
    });

    it('save con cola vacía', async () => {
      const s = setup();
      const r = await run(handler(s.router, 'playlist'), { subcommand: 'save', options: { name: 'x' } });
      expect(r.replies[0]).toContain('No hay pistas');
    });
  });

  describe('/dj', () => {
    it('no administrador: rechaza y no cambia el rol', async () => {
      const s = setup();
      const r = await run(handler(s.router, 'dj'), { subcommand: 'set', options: { role: 'r1' } });
      expect(r.replies[0]).toContain('administrador');
      expect(s.store.getDjRole('g1')).toBeNull();
    });

    it('administrador: set y clear', async () => {
      const s = setup();
      const admin = { roleIds: [], isAdmin: true, voiceChannelId: null };
      await run(handler(s.router, 'dj'), { subcommand: 'set', options: { role: 'r1' }, member: admin });
      expect(s.store.getDjRole('g1')).toBe('r1');
      await run(handler(s.router, 'dj'), { subcommand: 'clear', member: admin });
      expect(s.store.getDjRole('g1')).toBeNull();
    });
  });

  it('definiciones: 13 comandos con las opciones esperadas', () => {
    const defs = buildCommandDefinitions();
    expect(defs.map((d) => d.name).sort()).toEqual(
      ['dj', 'loop', 'nowplaying', 'pause', 'play', 'playlist', 'queue', 'remove', 'resume', 'shuffle', 'skip', 'stop', 'volume'],
    );
    const play = defs.find((d) => d.name === 'play')!;
    expect((play.options![0] as { autocomplete?: boolean }).autocomplete).toBe(true);
  });
});
