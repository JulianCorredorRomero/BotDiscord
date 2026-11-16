import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { Queue } from '../../src/core/queue.js';
import type { Track } from '../../src/core/types.js';
import { Resolver, type YtDlpOutput, type YtDlpRunner } from '../../src/resolver/resolver.js';

const trackArb: fc.Arbitrary<Track> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 11 }),
  title: fc.string({ minLength: 1, maxLength: 20 }),
  durationSec: fc.nat({ max: 20000 }),
  url: fc.constant('https://y/x'),
  thumbnailUrl: fc.constant('t'),
  requestedBy: fc.string({ minLength: 1, maxLength: 8 }),
});

type Failure = { name: string; input: string; out: YtDlpOutput | 'throw'; expected: string };

const fail = (stderr: string, code = 1): YtDlpOutput => ({ stdout: '', stderr, code, timedOut: false });
const okJson = (obj: unknown): YtDlpOutput => ({ stdout: JSON.stringify(obj), stderr: '', code: 0, timedOut: false });

const failureArb: fc.Arbitrary<Failure> = fc.constantFrom<Failure>(
  { name: 'invalid url', input: 'https://example.com/foo', out: fail(''), expected: 'invalid_link' },
  { name: 'ytdlp error', input: 'https://www.youtube.com/watch?v=abcdefghijk', out: fail('ERROR: Video unavailable'), expected: 'unavailable:deleted' },
  { name: 'private', input: 'https://www.youtube.com/watch?v=abcdefghijk', out: fail('ERROR: Private video'), expected: 'unavailable:private' },
  { name: 'region', input: 'https://www.youtube.com/watch?v=abcdefghijk', out: fail('The uploader has blocked it in your country'), expected: 'unavailable:region' },
  { name: 'age', input: 'https://www.youtube.com/watch?v=abcdefghijk', out: fail('Sign in to confirm your age'), expected: 'age_restricted' },
  { name: 'no results', input: 'some song name', out: okJson({ entries: [] }), expected: 'no_results' },
  { name: 'timeout', input: 'some song name', out: { stdout: '', stderr: '', code: 1, timedOut: true }, expected: 'timeout' },
  { name: 'runner throws', input: 'https://www.youtube.com/watch?v=abcdefghijk', out: 'throw', expected: 'invalid_link' },
);

describe('Resolver failures', () => {
  // Feature: discord-music-bot, Property 4: Los fallos de resolución no modifican la Cola
  // **Validates: Requirements 1.10, 7.1, 7.4**
  it('Property 4: a resolution error leaves the queue equal to the original and exposes the reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(trackArb, { nil: null }),
        fc.array(trackArb, { maxLength: 30 }),
        failureArb,
        async (current, pending, f) => {
          const q = new Queue();
          q.current = current;
          q.pending = [...pending];
          const before = structuredClone({ current: q.current, pending: q.pending });

          const runner: YtDlpRunner = async () => {
            if (f.out === 'throw') throw new Error('boom');
            return f.out;
          };
          const res = await new Resolver(runner).resolve(f.input, 'user');

          // Enqueue only on success.
          if (res.ok) {
            q.add(res.value.kind === 'track' ? [res.value.track] : res.value.tracks);
          }

          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error).toBe(f.expected);
          expect({ current: q.current, pending: q.pending }).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
