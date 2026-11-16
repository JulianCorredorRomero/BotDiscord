import { describe, expect, it } from 'vitest';
import { classifyInput } from './classify.js';
import { Resolver, buildPlaylist, mapYtDlpError, type YtDlpOutput, type YtDlpRunner } from './resolver.js';

const good = (stdout: unknown): YtDlpOutput => ({ stdout: JSON.stringify(stdout), stderr: '', code: 0, timedOut: false });
const fake = (o: YtDlpOutput): YtDlpRunner => async () => o;

describe('classifyInput', () => {
  it('classifies URLs and searches', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('video_url');
    expect(classifyInput('https://youtu.be/dQw4w9WgXcQ')).toBe('video_url');
    expect(classifyInput('https://www.youtube.com/playlist?list=PLabc123')).toBe('playlist_url');
    expect(classifyInput('https://example.com/x')).toBe('invalid_url');
    expect(classifyInput('https://www.youtube.com/watch?v=short')).toBe('invalid_url');
    expect(classifyInput('lofi hip hop')).toBe('search');
    expect(classifyInput('a'.repeat(100))).toBe('search');
    expect(classifyInput('a'.repeat(101))).toBe('invalid_url');
  });
});

describe('mapYtDlpError', () => {
  it('maps messages to typed errors', () => {
    expect(mapYtDlpError('ERROR: Private video. Sign in')).toBe('unavailable:private');
    expect(mapYtDlpError('Sign in to confirm your age')).toBe('age_restricted');
    expect(mapYtDlpError('not available in your country')).toBe('unavailable:region');
    expect(mapYtDlpError('Video unavailable')).toBe('unavailable:deleted');
    expect(mapYtDlpError('Unsupported URL')).toBe('invalid_link');
  });
});

describe('Resolver', () => {
  const entry = (id: string, title = 't') => ({ id, title, duration: 10.7 });

  it('resolves a search to the first result', async () => {
    const r = await new Resolver(fake(good({ entries: [entry('aaaaaaaaaaa', 'x')] }))).resolve('hola', 'u1');
    expect(r.ok && r.value.kind === 'track' && r.value.track.id).toBe('aaaaaaaaaaa');
  });

  it('returns no_results, timeout, invalid_link', async () => {
    const empty = await new Resolver(fake(good({ entries: [] }))).resolve('hola', 'u');
    expect(empty).toEqual({ ok: false, error: 'no_results' });
    const to = await new Resolver(fake({ stdout: '', stderr: '', code: 1, timedOut: true })).resolve('hola', 'u');
    expect(to).toEqual({ ok: false, error: 'timeout' });
    const inv = await new Resolver(fake(good({}))).resolve('https://example.com', 'u');
    expect(inv).toEqual({ ok: false, error: 'invalid_link' });
  });

  it('limits playlists to 100 and skips unavailable', () => {
    const entries = [
      entry('a'.repeat(11), '[Private video]'),
      ...Array.from({ length: 150 }, (_, i) => entry(String(i).padStart(11, '0'))),
    ];
    const p = buildPlaylist(entries, 'u');
    expect(p.tracks).toHaveLength(100);
    expect(p.skipped).toBe(1);
    expect(p.tracks[0]!.id).toBe('00000000000');
  });

  it('autocomplete returns [] on failure', async () => {
    const s = await new Resolver(fake({ stdout: '', stderr: 'x', code: 1, timedOut: false })).searchSuggestions('hi');
    expect(s).toEqual([]);
  });
});
