import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import { I18n } from '../../src/core/i18n.js';
import { RateLimiter } from '../../src/core/rateLimiter.js';
import { getSuggestions, handleAutocomplete } from '../../src/discord/autocomplete.js';
import { handleButton, nextLoopMode, type ButtonContext, type ButtonDeps } from '../../src/discord/buttons.js';
import { Guard } from '../../src/discord/guard.js';
import { NP_BUTTON_IDS } from '../../src/discord/nowPlayingMessage.js';
import type { Track } from '../../src/core/types.js';

const track = (n: number, title = `T${n}`): Track => ({
  id: `id${n}`,
  title,
  durationSec: 65,
  url: `https://youtu.be/${n}`,
  thumbnailUrl: '',
  requestedBy: 'u1',
});

function makePlayer(over: Record<string, unknown> = {}) {
  const ok = { ok: true, value: undefined };
  return {
    state: 'reproduciendo',
    loop: 'off',
    nowPlaying: vi.fn(() => ({ ok: true })),
    pause: vi.fn(async () => ok),
    resume: vi.fn(async () => ok),
    skip: vi.fn(async () => ({ ok: true, value: { next: null } })),
    stop: vi.fn(async () => ok),
    setLoop: vi.fn(() => ({ ok: true, value: 'track' })),
    adjustVolume: vi.fn(() => ({ ok: true, value: { volume: 60, saved: true } })),
    ...over,
  };
}

function setup(opts: { player?: ReturnType<typeof makePlayer> | null; dj?: string | null } = {}) {
  const clock = new FakeClock(0);
  const i18n = new I18n();
  const store = { getDjRole: () => opts.dj ?? null, getLanguage: () => 'es' };
  const guard = new Guard({ rateLimiter: new RateLimiter(clock), store, i18n, getBotVoiceChannelId: () => null });
  const player = opts.player === undefined ? makePlayer() : opts.player;
  const changed = vi.fn();
  const deps: ButtonDeps = {
    guard,
    players: { get: () => (player ?? undefined) as never },
    store,
    i18n,
    onPlaybackChanged: changed,
  };
  const calls: string[] = [];
  const mk = (customId: string, over: Partial<ButtonContext> = {}): ButtonContext => ({
    customId,
    userId: 'u1',
    guildId: 'g1',
    commandName: 'pause',
    optionNames: ['value'],
    member: { roleIds: [], isAdmin: false, voiceChannelId: 'vc1' },
    async reply(c, o) {
      calls.push(`reply:${o?.ephemeral ? 'eph:' : ''}${c}`);
    },
    async deferReply() {},
    async editReply() {},
    async followUp(c, o) {
      calls.push(`follow:${o?.ephemeral ? 'eph:' : ''}${c}`);
    },
    async deferUpdate() {
      calls.push('deferUpdate');
    },
    ...over,
  });
  return { deps, player, calls, changed, mk };
}

describe('handleButton', () => {
  it('pausa y reanuda según el estado actual y actualiza el mensaje', async () => {
    const s = setup();
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.pause));
    expect(s.player!.pause).toHaveBeenCalledWith('vc1');
    s.player!.state = 'pausado';
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.pause));
    expect(s.player!.resume).toHaveBeenCalledWith('vc1');
    expect(s.changed).toHaveBeenCalledTimes(2);
    expect(s.calls).toEqual(['deferUpdate', 'deferUpdate']);
  });

  it('skip, stop, loop cíclico y volumen ±10', async () => {
    const s = setup();
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.skip));
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.stop));
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.loop));
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.volUp));
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.volDown));
    expect(s.player!.skip).toHaveBeenCalled();
    expect(s.player!.stop).toHaveBeenCalled();
    expect(s.player!.setLoop).toHaveBeenCalledWith('vc1', 'track');
    expect(s.player!.adjustVolume).toHaveBeenNthCalledWith(1, 'vc1', 10);
    expect(s.player!.adjustVolume).toHaveBeenNthCalledWith(2, 'vc1', -10);
  });

  it('el ciclo de repetición es off→track→queue→off', () => {
    expect(nextLoopMode('off')).toBe('track');
    expect(nextLoopMode('track')).toBe('queue');
    expect(nextLoopMode('queue')).toBe('off');
  });

  it('rechazo del Guard (sin canal de voz) es efímero y no toca la reproducción', async () => {
    const s = setup();
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.skip, { member: { roleIds: [], isAdmin: false, voiceChannelId: null } }));
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatch(/^reply:eph:/);
    expect(s.player!.skip).not.toHaveBeenCalled();
    expect(s.changed).not.toHaveBeenCalled();
  });

  it('rechazo por Rol_DJ requerido', async () => {
    const s = setup({ dj: 'dj1' });
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.stop, { commandName: 'stop' }));
    expect(s.calls[0]).toMatch(/^reply:eph:/);
    expect(s.player!.stop).not.toHaveBeenCalled();
  });

  it('pista ya no activa: mensaje efímero sin cambios', async () => {
    const s = setup({ player: makePlayer({ nowPlaying: vi.fn(() => ({ ok: false })) }) });
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.pause));
    expect(s.calls).toEqual([expect.stringMatching(/^reply:eph:/)]);
    expect(s.player!.pause).not.toHaveBeenCalled();
  });

  it('sin reproductor: mensaje efímero', async () => {
    const s = setup({ player: null });
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.skip));
    expect(s.calls[0]).toMatch(/^reply:eph:/);
  });

  it('error del reproductor se informa por followUp efímero', async () => {
    const s = setup({
      player: makePlayer({ skip: vi.fn(async () => ({ ok: false, error: { reason: 'not_in_voice' } })) }),
    });
    await handleButton(s.deps, s.mk(NP_BUTTON_IDS.skip));
    expect(s.calls[1]).toMatch(/^follow:eph:/);
    expect(s.changed).not.toHaveBeenCalled();
  });

  it('ignora botones ajenos', async () => {
    const s = setup();
    expect(await handleButton(s.deps, s.mk('other:x'))).toBe(false);
    expect(s.calls).toEqual([]);
  });
});

describe('autocomplete', () => {
  it('devuelve como máximo 5 opciones con título truncado y duración', async () => {
    const tracks = [track(1, 'x'.repeat(300)), ...[2, 3, 4, 5, 6, 7].map((n) => track(n))];
    const out = await getSuggestions({ resolver: { searchSuggestions: async () => tracks } }, 'q');
    expect(out).toHaveLength(5);
    expect(out[0]!.name.length).toBeLessThanOrEqual(100);
    expect(out[0]!.name.endsWith('(01:05)')).toBe(true);
    expect(out[1]).toEqual({ name: 'T2 (01:05)', value: 'https://youtu.be/2' });
  });

  it('devuelve [] sin resultados, ante error o al agotar el plazo', async () => {
    expect(await getSuggestions({ resolver: { searchSuggestions: async () => [] } }, 'q')).toEqual([]);
    expect(
      await getSuggestions({ resolver: { searchSuggestions: async () => Promise.reject(new Error('x')) } }, 'q'),
    ).toEqual([]);
    const never = () => new Promise<Track[]>(() => undefined);
    expect(await getSuggestions({ resolver: { searchSuggestions: never }, timeoutMs: 10 }, 'q')).toEqual([]);
  });

  it('handleAutocomplete solo atiende /play query y no lanza si respond falla', async () => {
    const deps = { resolver: { searchSuggestions: async () => [track(1)] } };
    const respond = vi.fn(async () => Promise.reject(new Error('expired')));
    expect(await handleAutocomplete(deps, { commandName: 'play', focusedName: 'query', query: 'a', respond })).toBe(true);
    expect(respond).toHaveBeenCalled();
    expect(await handleAutocomplete(deps, { commandName: 'queue', focusedName: 'query', query: 'a', respond })).toBe(false);
  });
});
