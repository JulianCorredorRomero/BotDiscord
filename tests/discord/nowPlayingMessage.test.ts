import { describe, expect, it } from 'vitest';
import type { Track } from '../../src/core/types.js';
import {
  NowPlayingMessage,
  buildNowPlayingModel,
  renderNowPlaying,
  type NowPlayingChannelPort,
  type NowPlayingModel,
} from '../../src/discord/nowPlayingMessage.js';

const track: Track = {
  id: 'abc',
  title: 'Canción',
  durationSec: 245,
  url: 'https://youtu.be/abc',
  thumbnailUrl: 'https://img/x.jpg',
  requestedBy: '42',
};

function fakePort() {
  const log: string[] = [];
  let n = 0;
  const port: NowPlayingChannelPort & { failEdit: boolean; failSend: boolean } = {
    failEdit: false,
    failSend: false,
    async send(_m: NowPlayingModel) {
      if (port.failSend) throw new Error('x');
      const id = `m${++n}`;
      log.push(`send:${id}`);
      return id;
    },
    async edit(id: string, _m: NowPlayingModel) {
      if (port.failEdit) throw new Error('deleted');
      log.push(`edit:${id}`);
    },
  };
  return { port, log };
}

describe('buildNowPlayingModel', () => {
  it('contains track data and six labelled buttons', () => {
    const m = buildNowPlayingModel(track, '42', 'reproduciendo', 'off', 50);
    expect(m.title).toBe('Canción');
    expect(m.duration).toBe('04:05');
    expect(m.requester).toBe('42');
    expect(m.thumbnail).toBe(track.thumbnailUrl);
    expect(m.buttons.map((b) => b.id)).toEqual([
      'np:pause', 'np:skip', 'np:stop', 'np:loop', 'np:vol_up', 'np:vol_down',
    ]);
    expect(m.buttons.every((b) => b.label.length > 0 && !b.disabled)).toBe(true);
    expect(m.buttons[0]!.label).toBe('Pausar');
  });

  it('shows resume when paused', () => {
    const m = buildNowPlayingModel(track, '42', 'pausado', 'track', 50);
    expect(m.buttons[0]!.label).toBe('Reanudar');
  });

  it('finished disables all buttons and shows notice', () => {
    const m = buildNowPlayingModel(track, '42', 'inactivo', 'off', 50, true);
    expect(m.notice).toBeTruthy();
    expect(m.buttons).toHaveLength(6);
    expect(m.buttons.every((b) => b.disabled && b.label.length > 0)).toBe(true);
  });
});

describe('renderNowPlaying', () => {
  it('splits 6 buttons into rows of at most 5', () => {
    const r = renderNowPlaying(buildNowPlayingModel(track, '42', 'reproduciendo', 'off', 50));
    expect(r.components.map((c) => c.components.length)).toEqual([5, 1]);
    expect(r.embeds).toHaveLength(1);
  });
});

describe('NowPlayingMessage', () => {
  const model = buildNowPlayingModel(track, '42', 'reproduciendo', 'off', 50);

  it('posts then edits the same message', async () => {
    const { port, log } = fakePort();
    const np = new NowPlayingMessage(port);
    await np.post(model);
    await np.update(model);
    expect(log).toEqual(['send:m1', 'edit:m1']);
  });

  it('recreates the message when edit fails', async () => {
    const { port, log } = fakePort();
    const np = new NowPlayingMessage(port);
    await np.post(model);
    port.failEdit = true;
    expect(await np.update(model)).toBe(true);
    expect(log).toEqual(['send:m1', 'send:m2']);
    expect(np.ref).toBe('m2');
  });

  it('recreates when edit exceeds the timeout', async () => {
    const { port, log } = fakePort();
    const np = new NowPlayingMessage(port, { editTimeoutMs: 10 });
    await np.post(model);
    port.edit = () => new Promise(() => {});
    await np.update(model);
    expect(log).toEqual(['send:m1', 'send:m2']);
  });

  it('finish sends a final model with disabled buttons', async () => {
    const { port } = fakePort();
    const np = new NowPlayingMessage(port);
    await np.post(model);
    await np.finish(track, '42', 'off', 50);
    expect(np.model!.finished).toBe(true);
    expect(np.model!.buttons.every((b) => b.disabled)).toBe(true);
  });

  it('returns false when sending fails', async () => {
    const { port } = fakePort();
    port.failSend = true;
    expect(await new NowPlayingMessage(port).post(model)).toBe(false);
  });
});
