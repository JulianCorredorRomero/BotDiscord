import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import { I18n } from '../../src/core/i18n.js';
import { Logger } from '../../src/core/logger.js';
import { RateLimiter } from '../../src/core/rateLimiter.js';
import { Guard, type InteractionContext } from '../../src/discord/guard.js';
import { InteractionRouter } from '../../src/discord/router.js';

interface Call {
  kind: 'reply' | 'defer' | 'edit' | 'followUp';
  content?: string;
  ephemeral?: boolean;
}

function makeCtx(over: Partial<InteractionContext> = {}): { ctx: InteractionContext; calls: Call[] } {
  const calls: Call[] = [];
  const ctx: InteractionContext = {
    userId: 'u1',
    guildId: 'g1',
    commandName: 'play',
    subcommand: null,
    optionNames: [],
    member: { roleIds: [], isAdmin: false, voiceChannelId: 'vc1' },
    async reply(content, o) {
      calls.push({ kind: 'reply', content, ephemeral: o?.ephemeral });
    },
    async deferReply(o) {
      calls.push({ kind: 'defer', ephemeral: o?.ephemeral });
    },
    async editReply(content) {
      calls.push({ kind: 'edit', content });
    },
    async followUp(content, o) {
      calls.push({ kind: 'followUp', content, ephemeral: o?.ephemeral });
    },
    ...over,
  };
  return { ctx, calls };
}

function setup(opts: { dj?: string | null; botChannel?: string | null } = {}) {
  const clock = new FakeClock(0);
  const logs: string[] = [];
  const logger = new Logger(['SECRET'], (l) => logs.push(l));
  const i18n = new I18n();
  const store = { getDjRole: () => opts.dj ?? null, getLanguage: () => 'es' };
  const guard = new Guard({
    rateLimiter: new RateLimiter(clock),
    store,
    i18n,
    getBotVoiceChannelId: () => opts.botChannel ?? null,
  });
  const router = new InteractionRouter({ guard, logger, i18n, clock, store });
  return { clock, logs, router, i18n };
}

describe('Guard', () => {
  it('rechaza por límite de uso con segundos restantes (redondeo hacia arriba)', async () => {
    const { router, clock } = setup();
    let runs = 0;
    router.register('play', { run: async () => void runs++ });
    for (let i = 0; i < 5; i++) await router.handle(makeCtx().ctx);
    clock.advance(2500);
    const { ctx, calls } = makeCtx();
    await router.handle(ctx);
    expect(runs).toBe(5);
    expect(calls[0]!.content).toContain('8 s');
  });

  it('rechaza comando restringido sin Rol_DJ y no ejecuta el manejador', async () => {
    const { router } = setup({ dj: 'dj-role', botChannel: 'vc1' });
    let runs = 0;
    router.register('skip', { run: async () => void runs++ });
    const { ctx, calls } = makeCtx({ commandName: 'skip' });
    await router.handle(ctx);
    expect(runs).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.content).toMatch(/Rol_DJ/);
  });

  it('permite restringido con Rol_DJ o administrador', async () => {
    const { router } = setup({ dj: 'dj-role', botChannel: 'vc1' });
    let runs = 0;
    router.register('skip', { run: async () => void runs++ });
    await router.handle(makeCtx({ commandName: 'skip', member: { roleIds: ['dj-role'], isAdmin: false, voiceChannelId: null } }).ctx);
    await router.handle(makeCtx({ commandName: 'skip', member: { roleIds: [], isAdmin: true, voiceChannelId: null } }).ctx);
    expect(runs).toBe(2);
  });

  it('sin Rol_DJ exige estar en el canal del Bot', async () => {
    const { router } = setup({ botChannel: 'vc-bot' });
    let runs = 0;
    router.register('pause', { run: async () => void runs++ });
    const { ctx, calls } = makeCtx({ commandName: 'pause' });
    await router.handle(ctx);
    expect(runs).toBe(0);
    expect(calls[0]!.content).toMatch(/canal de voz/);
  });
});

describe('InteractionRouter', () => {
  it('difiere de inmediato si el manejador es lento y edita la respuesta', async () => {
    const { router } = setup();
    router.register('play', { slow: true, run: async (c) => c.respond('listo') });
    const { ctx, calls } = makeCtx();
    await router.handle(ctx);
    expect(calls.map((c) => c.kind)).toEqual(['defer', 'edit']);
  });

  it('difiere tras 2 s si el manejador no ha respondido', async () => {
    const { router, clock } = setup();
    let release!: () => void;
    router.register('play', {
      run: async (c) => {
        await new Promise<void>((r) => (release = r));
        await c.respond('hecho');
      },
    });
    const { ctx, calls } = makeCtx();
    const p = router.handle(ctx);
    await Promise.resolve();
    clock.advance(1999);
    expect(calls).toHaveLength(0);
    clock.advance(1);
    await Promise.resolve();
    expect(calls.map((c) => c.kind)).toEqual(['defer']);
    release();
    await p;
    expect(calls.map((c) => c.kind)).toEqual(['defer', 'edit']);
  });

  it('usa respuestas efímeras para comandos de consulta', async () => {
    const { router } = setup({ botChannel: 'vc1' });
    for (const n of ['queue', 'nowplaying', 'volume', 'playlist']) {
      router.register(n, { run: async (c) => c.respond('x') });
    }
    const cases: Array<[Partial<InteractionContext>, boolean]> = [
      [{ commandName: 'queue' }, true],
      [{ commandName: 'nowplaying' }, true],
      [{ commandName: 'volume' }, true],
      [{ commandName: 'volume', optionNames: ['value'] }, false],
      [{ commandName: 'playlist', subcommand: 'list' }, true],
      [{ commandName: 'playlist', subcommand: 'save', optionNames: ['name'] }, false],
    ];
    let n = 0;
    for (const [over, eph] of cases) {
      const { ctx, calls } = makeCtx({ userId: `user${n++}`, member: { roleIds: [], isAdmin: true, voiceChannelId: 'vc1' }, ...over });
      await router.handle(ctx);
      expect(!!calls[0]!.ephemeral, JSON.stringify(over)).toBe(eph);
    }
  });

  it('error inesperado: respuesta genérica sin detalles, registro con comando/usuario/servidor y sigue operativo', async () => {
    const { router, logs, i18n } = setup();
    let fail = true;
    router.register('play', {
      run: async (c) => {
        if (fail) throw new Error('boom C:\\secret\\path.ts SECRET');
        await c.respond('ok');
      },
    });
    const first = makeCtx();
    await router.handle(first.ctx);
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]!.content).toBe(i18n.t('error.generic'));
    expect(first.calls[0]!.content).not.toMatch(/boom|path|SECRET/);
    expect(logs[0]).toContain('command=play');
    expect(logs[0]).toContain('userId=u1');
    expect(logs[0]).toContain('guildId=g1');
    expect(logs[0]).not.toContain('SECRET');

    fail = false;
    const second = makeCtx({ userId: 'u2' });
    await router.handle(second.ctx);
    expect(second.calls[0]!.content).toBe('ok');
  });

  it('error tras diferir edita la respuesta con el mensaje genérico', async () => {
    const { router, i18n } = setup();
    router.register('play', {
      slow: true,
      run: async () => {
        throw new Error('x');
      },
    });
    const { ctx, calls } = makeCtx();
    await router.handle(ctx);
    expect(calls.map((c) => c.kind)).toEqual(['defer', 'edit']);
    expect(calls[1]!.content).toBe(i18n.t('error.generic'));
  });
});
