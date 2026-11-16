import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { PipelineHandle } from '../../src/audio/audioPipeline.js';
import { FakeClock } from '../../src/core/clock.js';
import { ok } from '../../src/core/result.js';
import type { Track } from '../../src/core/types.js';
import { PlayerManager, type GuildPlayerDeps, type VoiceSession } from '../../src/player/index.js';

const track = (id: string): Track => ({
  id, title: id, durationSec: 100, url: `https://y/${id}`, thumbnailUrl: 't', requestedBy: 'u',
});

function makeSession(channelId: string, destroyed: string[], guildId: string): VoiceSession {
  return {
    channelId,
    channelBitrateKbps: 64,
    humanCount: () => 1,
    setListener: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    unpause: () => undefined,
    stopOutput: () => undefined,
    reconnect: async () => false,
    destroy: () => void destroyed.push(guildId),
  };
}

function setup() {
  const destroyed: string[] = [];
  const created: string[] = [];
  const manager = new PlayerManager((guildId): GuildPlayerDeps => {
    created.push(guildId);
    return {
      guildId,
      clock: new FakeClock(0),
      notifier: { notify: () => undefined },
      store: { getVolume: () => 50, setVolume: () => ok(undefined) },
      connector: {
        checkPermissions: () => ({ connect: true, speak: true }),
        connect: async (id) => makeSession(id, destroyed, guildId),
      },
      pipelines: {
        start: async () =>
          ({
            stream: new PassThrough(),
            setVolume: () => undefined,
            pause: async () => undefined,
            resume: () => undefined,
            fadeOutAndStop: async () => undefined,
            destroy: () => undefined,
            failed: new Promise<never>(() => undefined),
          }) satisfies PipelineHandle,
      },
    };
  });
  return { manager, destroyed, created };
}

describe('PlayerManager', () => {
  it('crea de forma perezosa y reutiliza el reproductor por Servidor', () => {
    const { manager, created } = setup();
    expect(manager.get('a')).toBeUndefined();
    const a = manager.getOrCreate('a');
    expect(manager.getOrCreate('a')).toBe(a);
    expect(manager.get('a')).toBe(a);
    expect(created).toEqual(['a']);
  });

  it('aísla Colas y volumen entre Servidores', async () => {
    const { manager } = setup();
    const a = manager.getOrCreate('a');
    const b = manager.getOrCreate('b');
    expect(a).not.toBe(b);
    expect(a.queue).not.toBe(b.queue);
    await a.enqueue([track('x')], 'v1');
    expect(a.queue.current?.id).toBe('x');
    expect(b.queue.current).toBeNull();
    expect(b.state).toBe('inactivo');
  });

  it('destroy libera la sesión de ese Servidor y no afecta a los demás', async () => {
    const { manager, destroyed } = setup();
    await manager.getOrCreate('a').enqueue([track('x')], 'v1');
    await manager.getOrCreate('b').enqueue([track('y')], 'v2');
    expect(manager.destroy('a')).toBe(true);
    expect(manager.destroy('a')).toBe(false);
    expect(destroyed).toEqual(['a']);
    expect(manager.get('a')).toBeUndefined();
    expect(manager.get('b')?.queue.current?.id).toBe('y');
  });

  it('retira al reproductor cuando se libera por /stop y crea uno nuevo después', async () => {
    const { manager } = setup();
    const a = manager.getOrCreate('a');
    await a.enqueue([track('x')], 'v1');
    await a.stop('v1');
    expect(manager.get('a')).toBeUndefined();
    expect(manager.getOrCreate('a')).not.toBe(a);
  });

  it('destroyAll vacía el registro y libera todas las sesiones', async () => {
    const { manager, destroyed } = setup();
    await manager.getOrCreate('a').enqueue([track('x')], 'v1');
    await manager.getOrCreate('b').enqueue([track('y')], 'v2');
    manager.destroyAll();
    expect(manager.size).toBe(0);
    expect([...destroyed].sort()).toEqual(['a', 'b']);
  });
});
