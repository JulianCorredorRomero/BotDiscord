import { PassThrough } from 'node:stream';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AudioError } from '../../src/audio/errors.js';
import type { PipelineHandle } from '../../src/audio/audioPipeline.js';
import { FakeClock } from '../../src/core/clock.js';
import { ok } from '../../src/core/result.js';
import type { Track } from '../../src/core/types.js';
import {
  GuildPlayer,
  type PlayerNotice,
  type VoiceSession,
  type VoiceSessionListener,
} from '../../src/player/index.js';

type Reason = 'processing' | 'unavailable' | 'age_restricted' | 'download_failed';

const FAILURES: Array<{ make: () => unknown; reason: Reason }> = [
  { make: () => new Error('ffmpeg crashed'), reason: 'processing' },
  { make: () => ({ reason: 'deleted' }), reason: 'unavailable' },
  { make: () => ({ reason: 'private' }), reason: 'unavailable' },
  { make: () => ({ reason: 'region' }), reason: 'unavailable' },
  { make: () => ({ reason: 'age_restricted' }), reason: 'age_restricted' },
  { make: () => new AudioError('download_failed', 'x'), reason: 'download_failed' },
];

class FakeSession implements VoiceSession {
  listener!: VoiceSessionListener;
  destroyed = false;
  channelBitrateKbps = 64;
  constructor(public channelId: string) {}
  humanCount() { return 1; }
  setListener(l: VoiceSessionListener) { this.listener = l; }
  play() {}
  pause() {}
  unpause() {}
  stopOutput() {}
  async reconnect() { return false; }
  destroy() { this.destroyed = true; }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe('Property 23: failed tracks', () => {
  // Feature: discord-music-bot, Property 23: Una pista fallida se omite y la Cola continúa
  // **Validates: Requirements 5.8, 5.9, 7.2, 7.3, 7.5**
  it('notifica título y motivo, omite la pista, conserva el orden y mantiene la conexión', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.option(fc.integer({ min: 0, max: FAILURES.length - 1 }), { nil: null }), { minLength: 1, maxLength: 8 }),
        async (plan) => {
          const tracks: Track[] = plan.map((_, i) => ({
            id: `id-${i}`, title: `Title ${i}`, durationSec: 100, url: `https://y/id-${i}`, thumbnailUrl: 't', requestedBy: 'u',
          }));
          const notices: PlayerNotice[] = [];
          const sessions: FakeSession[] = [];
          const started: string[] = [];
          const player = new GuildPlayer({
            guildId: 'g',
            clock: new FakeClock(0),
            notifier: { notify: (n) => notices.push(n) },
            store: { getVolume: () => 50, setVolume: () => ok(undefined) },
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
                const idx = tracks.findIndex((t) => t.url === req.url);
                const f = plan[idx];
                if (f !== null && f !== undefined) throw FAILURES[f]!.make();
                started.push(req.url);
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
          });

          await player.enqueue(tracks, 'v1');
          await flush();
          // Cada pista buena que suena termina y se pasa a la siguiente.
          for (let i = 0; i < tracks.length && player.state === 'reproduciendo'; i++) {
            sessions[0]!.listener.onTrackEnd();
            await flush();
          }

          const expectedFailed = plan.flatMap((f, i) =>
            f === null ? [] : [{ type: 'track_failed', title: tracks[i]!.title, reason: FAILURES[f]!.reason }],
          );
          const expectedPlayed = tracks.filter((_, i) => plan[i] === null).map((t) => t.url);

          expect(notices.filter((n) => n.type === 'track_failed')).toEqual(expectedFailed);
          expect(started).toEqual(expectedPlayed);
          expect(notices.filter((n) => n.type === 'queue_finished')).toHaveLength(1);
          expect(player.state).toBe('inactivo');
          expect(player.queue.current).toBeNull();
          expect(player.queue.pending).toHaveLength(0);
          expect(player.connected).toBe(true);
          expect(sessions[0]!.destroyed).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
