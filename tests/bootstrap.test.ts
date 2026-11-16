import { describe, expect, it } from 'vitest';
import { GatewayIntentBits, PermissionFlagsBits, Routes } from 'discord.js';
import {
  BOT_INTENTS,
  BOT_PERMISSIONS,
  buildInviteUrl,
  createClientOptions,
  registerSlashCommands,
  startBot,
  type BotClientPort,
  type RestPort,
} from '../src/bootstrap.js';
import { FakeClock } from '../src/core/clock.js';
import { loadConfig } from '../src/core/config.js';
import { Logger } from '../src/core/logger.js';
import { SqliteStore } from '../src/store/store.js';

const TOKEN = 'SUPER.secret.TOKEN-123456';
const CLIENT_ID = '987654321098765432';

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function makeLogger(secrets: string[] = [TOKEN, CLIENT_ID]) {
  const lines: string[] = [];
  return { lines, logger: new Logger(secrets, (l) => lines.push(l)) };
}

function failingRest(failures: number, message = 'boom') {
  let calls = 0;
  const routes: string[] = [];
  const rest: RestPort = {
    put: async (route) => {
      calls++;
      routes.push(route);
      if (calls <= failures) throw new Error(message);
      return [];
    },
  };
  return { rest, calls: () => calls, routes };
}

describe('registerSlashCommands (Req. 9.9, 9.10)', () => {
  it('registra a la primera sin reintentos', async () => {
    const clock = new FakeClock();
    const { lines, logger } = makeLogger();
    const { rest, calls } = failingRest(0);
    const r = await registerSlashCommands({ rest, clientId: CLIENT_ID, commands: [], clock, logger });
    expect(r).toEqual({ ok: true, attempts: 1 });
    expect(calls()).toBe(1);
    expect(lines.some((l) => l.includes('command_registration_failed'))).toBe(false);
  });

  it('falla dos veces y tiene éxito al reintentar cada 10 s, registrando cada causa', async () => {
    const clock = new FakeClock();
    const { lines, logger } = makeLogger();
    const { rest, calls } = failingRest(2, 'HTTP 503');
    const p = registerSlashCommands({ rest, clientId: CLIENT_ID, commands: [], clock, logger });
    await settle();
    expect(calls()).toBe(1);
    clock.advance(9_999);
    await settle();
    expect(calls()).toBe(1);
    clock.advance(1);
    await settle();
    expect(calls()).toBe(2);
    clock.advance(10_000);
    await settle();
    expect(calls()).toBe(3);
    await expect(p).resolves.toEqual({ ok: true, attempts: 3 });
    const failed = lines.filter((l) => l.includes('command_registration_failed'));
    expect(failed).toHaveLength(2);
    expect(failed.every((l) => l.includes('HTTP 503'))).toBe(true);
  });

  it('tras el intento inicial y 3 reintentos fallidos registra el fallo y se detiene', async () => {
    const clock = new FakeClock();
    const { lines, logger } = makeLogger();
    const { rest, calls } = failingRest(Infinity, 'HTTP 500');
    const p = registerSlashCommands({ rest, clientId: CLIENT_ID, commands: [], clock, logger });
    for (let i = 0; i < 3; i++) {
      await settle();
      clock.advance(10_000);
    }
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(4);
    expect(calls()).toBe(4);
    clock.advance(60_000);
    await settle();
    expect(calls()).toBe(4); // no sigue reintentando
    expect(lines.filter((l) => l.includes('command_registration_failed'))).toHaveLength(4);
    expect(lines.some((l) => l.includes('command_registration_gave_up') && l.includes('HTTP 500'))).toBe(true);
  });

  it('un intento que no termina en 60 s cuenta como fallo con su causa', async () => {
    const clock = new FakeClock();
    const { lines, logger } = makeLogger();
    let calls = 0;
    const rest: RestPort = {
      put: () => (++calls === 1 ? new Promise(() => undefined) : Promise.resolve([])),
    };
    const p = registerSlashCommands({ rest, clientId: CLIENT_ID, commands: [], clock, logger });
    await settle();
    clock.advance(60_000);
    await settle();
    clock.advance(10_000);
    await settle();
    await expect(p).resolves.toEqual({ ok: true, attempts: 2 });
    expect(lines.some((l) => l.includes('command_registration_failed') && l.includes('60000'))).toBe(true);
  });

  it('usa ruta de Servidor si hay guildId y global en otro caso', async () => {
    const clock = new FakeClock();
    const { logger } = makeLogger();
    const a = failingRest(0);
    await registerSlashCommands({ rest: a.rest, clientId: CLIENT_ID, commands: [], clock, logger });
    expect(a.routes).toEqual([Routes.applicationCommands(CLIENT_ID)]);
    const b = failingRest(0);
    await registerSlashCommands({ rest: b.rest, clientId: CLIENT_ID, guildId: '42', commands: [], clock, logger });
    expect(b.routes).toEqual([Routes.applicationGuildCommands(CLIENT_ID, '42')]);
  });
});

describe('intents y permisos (Req. 8.8)', () => {
  it('el cliente solicita exactamente Guilds y GuildVoiceStates', () => {
    expect([...BOT_INTENTS].sort()).toEqual([GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates].sort());
    expect(createClientOptions().intents).toEqual([...BOT_INTENTS]);
  });

  it('los permisos son exactamente Connect, Speak, SendMessages y EmbedLinks', () => {
    const expected =
      PermissionFlagsBits.Connect |
      PermissionFlagsBits.Speak |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.EmbedLinks;
    expect(BOT_PERMISSIONS).toBe(expected);
  });

  it('la URL de invitación lleva esos permisos y los scopes bot y applications.commands', () => {
    const url = new URL(buildInviteUrl(CLIENT_ID));
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('permissions')).toBe(BOT_PERMISSIONS.toString());
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
  });
});

function fakeClient(opts: { loginError?: Error } = {}) {
  const listeners = new Map<string, Array<(...a: never[]) => void>>();
  let destroyed = 0;
  const client = {
    on(event: string, l: (...a: never[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), l]);
      return client;
    },
    login: async () => {
      if (opts.loginError) throw opts.loginError;
      return 'ok';
    },
    destroy: async () => void destroyed++,
    user: { id: 'bot' },
    channels: { fetch: async () => null },
  };
  return { client: client as unknown as BotClientPort, listeners, destroyed: () => destroyed };
}

function baseDeps(overrides: { rest: RestPort; client: BotClientPort; logger: Logger; clock: FakeClock }) {
  const cfg = loadConfig({ DISCORD_TOKEN: TOKEN, DISCORD_CLIENT_ID: CLIENT_ID });
  if (!cfg.ok) throw new Error('config');
  return {
    config: cfg.value,
    store: new SqliteStore(':memory:'),
    resolver: { resolve: async () => ({ ok: false as const, error: 'no_results' as const }), searchSuggestions: async () => [] },
    audio: { start: async () => { throw new Error('no audio'); } },
    connectorFor: () => { throw new Error('no voice'); },
    ...overrides,
  };
}

describe('startBot', () => {
  it('nunca escribe el token en los registros, ni siquiera en errores de registro o de login', async () => {
    const clock = new FakeClock();
    const { lines, logger } = makeLogger(loadSecrets());
    const { rest } = failingRest(Infinity, `401 Unauthorized: token ${TOKEN}`);
    const { client } = fakeClient();
    const handle = await startBot(baseDeps({ rest, client, logger, clock }));
    for (let i = 0; i < 3; i++) {
      await settle();
      clock.advance(10_000);
    }
    const r = await handle.registration;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain(TOKEN);
    await handle.stop();

    const bad = fakeClient({ loginError: new Error(`login fail ${TOKEN}`) });
    const l2 = makeLogger(loadSecrets());
    const err = await startBot(baseDeps({ rest, client: bad.client, logger: l2.logger, clock })).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of [...lines, ...l2.lines]) expect(line).not.toContain(TOKEN);
  });

  it('registra los listeners de interacciones y de estado de voz, y stop() cierra cliente y almacén una vez', async () => {
    const clock = new FakeClock();
    const { logger } = makeLogger(loadSecrets());
    const { rest } = failingRest(0);
    const f = fakeClient();
    const handle = await startBot(baseDeps({ rest, client: f.client, logger, clock }));
    expect(f.listeners.has('interactionCreate')).toBe(true);
    expect(f.listeners.has('voiceStateUpdate')).toBe(true);
    await expect(handle.registration).resolves.toMatchObject({ ok: true });
    await handle.stop();
    await handle.stop();
    expect(f.destroyed()).toBe(1);
  });
});

function loadSecrets(): string[] {
  return [TOKEN, CLIENT_ID];
}
