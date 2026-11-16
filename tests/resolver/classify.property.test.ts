import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { classifyInput } from '../../src/resolver/classify.js';

const idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('');
const videoId = fc.array(fc.constantFrom(...idChars), { minLength: 11, maxLength: 11 }).map((a) => a.join(''));
const listId = fc.array(fc.constantFrom(...idChars), { minLength: 2, maxLength: 34 }).map((a) => a.join(''));
const ytHost = fc.constantFrom('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com');
const scheme = fc.constantFrom('http', 'https');

const videoUrl = fc.oneof(
  fc.tuple(scheme, ytHost, videoId).map(([s, h, v]) => `${s}://${h}/watch?v=${v}`),
  fc.tuple(scheme, videoId).map(([s, v]) => `${s}://youtu.be/${v}`),
  fc.tuple(scheme, ytHost, fc.constantFrom('shorts', 'live', 'embed'), videoId).map(([s, h, p, v]) => `${s}://${h}/${p}/${v}`),
);
const playlistUrl = fc.tuple(scheme, ytHost, listId).map(([s, h, l]) => `${s}://${h}/playlist?list=${l}`);

const notUrlText = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0 && s.trim().length <= 100 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s.trim()) && !/^www\./i.test(s.trim()));

const foreignUrl = fc
  .tuple(scheme, fc.constantFrom('example.com', 'vimeo.com', 'notyoutube.com', 'youtube.com.evil.io', 'twitch.tv'), fc.webPath())
  .map(([s, h, p]) => `${s}://${h}${p}`);
const badYoutubeUrl = fc.oneof(
  fc.tuple(scheme, ytHost, fc.string({ maxLength: 10 }).filter((v) => !/^[A-Za-z0-9_-]{11}$/.test(v)))
    .map(([s, h, v]) => `${s}://${h}/watch?v=${encodeURIComponent(v)}`),
  fc.tuple(scheme, ytHost).map(([s, h]) => `${s}://${h}/`),
  fc.tuple(scheme, ytHost).map(([s, h]) => `${s}://${h}/playlist`),
);
const longText = fc
  .string({ minLength: 101, maxLength: 300 })
  .filter((s) => s.trim().length > 100 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s.trim()) && !/^www\./i.test(s.trim()));

describe('classifyInput property', () => {
  // Feature: discord-music-bot, Property 1: Clasificación de entradas de /play
  // **Validates: Requirements 1.2, 7.1**
  it('classifies video URLs, playlist URLs, searches and invalid URLs', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          videoUrl.map((i) => ({ i, k: 'video_url' })),
          playlistUrl.map((i) => ({ i, k: 'playlist_url' })),
          notUrlText.map((i) => ({ i, k: 'search' })),
          foreignUrl.map((i) => ({ i, k: 'invalid_url' })),
          badYoutubeUrl.map((i) => ({ i, k: 'invalid_url' })),
          longText.map((i) => ({ i, k: 'invalid_url' })),
        ),
        ({ i, k }) => {
          expect(classifyInput(i)).toBe(k);
        },
      ),
      { numRuns: 100 },
    );
  });
});
