import { PassThrough } from 'node:stream';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { expect } from 'vitest';
import type { PipelineHandle } from '../../src/audio/audioPipeline.js';
import { FakeClock } from '../../src/core/clock.js';
import { ok } from '../../src/core/result.js';
import type { Track } from '../../src/core/types.js';
import { PlayerManager, type GuildPlayerDeps, type VoiceSession } from '../../src/player/index.js';

const track = (id: string): Track => ({
  id, title: id, durationSec: 100, url: `https://y/${id}`, thumbnailUrl: 't', requestedBy: 'u',
});

function makeSession(channelId: string): VoiceSession {
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
    destroy: () => undefined,
  };
}

function setup(initialVolumes: Map<string, number>) {
  return new PlayerManager((guildId): GuildPlayerDeps => {
    const volumes = new Map(initialVolumes);
    return {
      guildId,
      clock: new FakeClock(0),
      notifier: { notify: () => undefined },
      store: {
        getVolume: (id) => volumes.get(id) ?? 50,
        setVolume: (id, v) => (volumes.set(id, v), ok(undefined)),
      },
      connector: {
        checkPermissions: () => ({ connect: true, speak: true }),
        connect: async (id) => makeSession(id),
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
}

type Op =
  | { kind: 'enqueue'; n: number; ch: boolean }
  | { kind: 'pause' | 'resume' | 'skip' | 'stop' | 'destroy'; ch: boolean }
  | { kind: 'loop'; mode: unknown; ch: boolean }
  | { kind: 'volume'; value: unknown; ch: boolean }
  | { kind: 'adjust'; delta: 10 | -10; ch: boolean };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('enqueue' as const), n: fc.integer({ min: 0, max: 5 }), ch: fc.boolean() }),
  fc.record({ kind: fc.constantFrom('pause', 'resume', 'skip', 'stop', 'destroy') as fc.Arbitrary<'pause'>, ch: fc.boolean() }),
  fc.record({ kind: fc.constant('loop' as const), mode: fc.oneof(fc.constantFrom('off', 'track', 'queue'), fc.string()), ch: fc.boolean() }),
  fc.record({ kind: fc.constant('volume' as const), value: fc.oneof(fc.integer({ min: -20, max: 120 }), fc.string(), fc.double()), ch: fc.boolean() }),
  fc.record({ kind: fc.constant('adjust' as const), delta: fc.constantFrom(10 as const, -10 as const), ch: fc.boolean() }),
);

function snapshot(manager: PlayerManager, guildId: string) {
  const p = manager.get(guildId);
  if (!p) return null;
  return {
    current: p.queue.current?.id ?? null,
    pending: p.queue.pending.map((t) => t.id),
    position: p.positionMs(),
    state: p.state,
    volume: p.currentVolume,
    loop: p.loop,
    channel: p.voiceChannelId,
  };
}

describe('Propiedad 37: Aislamiento entre Servidores', () => {
  // Feature: discord-music-bot, Property 37: Aislamiento entre Servidores
  // **Validates: Requirements 10.6**
  it('una operación sobre un Servidor no altera Cola, posición, pausa, volumen ni repetición de los demás', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ tracks: fc.integer({ min: 0, max: 4 }), vol: fc.integer({ min: 0, max: 100 }) }), { minLength: 1, maxLength: 4 }),
        fc.array(opArb, { minLength: 1, maxLength: 8 }),
        async (others, ops) => {
          const manager = setup(new Map());
          const target = manager.getOrCreate('target');
          await target.enqueue([track('t0'), track('t1')], 'vt');
          const ids: string[] = [];
          for (const [i, o] of others.entries()) {
            const id = `g${i}`;
            ids.push(id);
            const p = manager.getOrCreate(id);
            await p.enqueue(Array.from({ length: o.tracks }, (_, k) => track(`${id}-${k}`)), `v${i}`);
            p.setVolume(`v${i}`, o.vol);
            if (i % 2 === 0) p.setLoop(`v${i}`, 'queue');
            if (i % 3 === 1) await p.pause(`v${i}`);
          }
          const before = ids.map((id) => snapshot(manager, id));

          for (const op of ops) {
            const p = manager.getOrCreate('target');
            const ch = op.ch ? 'vt' : 'otro';
            switch (op.kind) {
              case 'enqueue': await p.enqueue(Array.from({ length: op.n }, (_, k) => track(`x${k}`)), ch); break;
              case 'pause': await p.pause(ch); break;
              case 'resume': await p.resume(ch); break;
              case 'skip': await p.skip(ch); break;
              case 'stop': await p.stop(ch); break;
              case 'destroy': manager.destroy('target'); break;
              case 'loop': p.setLoop(ch, op.mode); break;
              case 'volume': p.setVolume(ch, op.value); break;
              case 'adjust': p.adjustVolume(ch, op.delta); break;
            }
          }

          expect(ids.map((id) => snapshot(manager, id))).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
