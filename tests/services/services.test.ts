import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import { Queue } from '../../src/core/queue.js';
import type { Track } from '../../src/core/types.js';
import { DjService, PlaylistService, VolumeService } from '../../src/services/index.js';
import { SqliteStore } from '../../src/store/store.js';

const t = (id: string): Track => ({
  id,
  title: `T${id}`,
  durationSec: 1,
  url: `https://y/${id}`,
  thumbnailUrl: 'th',
  requestedBy: 'u1',
});

function setup() {
  const store = new SqliteStore(':memory:');
  const clock = new FakeClock();
  return { store, clock, svc: new PlaylistService(store, clock) };
}

describe('PlaylistService', () => {
  it('guarda actual + pendientes y lista en orden alfabético', () => {
    const { svc } = setup();
    const base = { guildId: 'g', userId: 'u1', current: t('1'), pending: [t('2')] };
    expect(svc.save({ ...base, name: 'beta' })).toEqual({ status: 'saved', name: 'beta', trackCount: 2 });
    svc.save({ ...base, name: 'alfa' });
    const l = svc.list('g', 'u1');
    expect(l.status === 'ok' && l.playlists.map((p) => p.name)).toEqual(['alfa', 'beta']);
    expect(svc.list('g', 'u2').status).toBe('empty');
    expect(svc.list('g2', 'u1').status).toBe('empty');
  });

  it('rechaza guardar sin pistas', () => {
    const { svc } = setup();
    expect(svc.save({ guildId: 'g', userId: 'u1', name: 'x', current: null, pending: [] }).status).toBe('empty');
  });

  it('sobrescribe solo con confirmación dentro de 30 s', () => {
    const { svc, store } = setup();
    svc.save({ guildId: 'g', userId: 'u1', name: 'x', current: t('1'), pending: [] });
    const r = svc.save({ guildId: 'g', userId: 'u1', name: 'x', current: t('1'), pending: [t('2')] });
    expect(r.status).toBe('confirm_required');
    expect(store.listPlaylists('g', 'u1')[0]?.trackCount).toBe(1);
    expect(svc.confirmSave('g', 'u1', 'x', true)).toEqual({ status: 'saved', name: 'x', trackCount: 2 });
  });

  it('cancela al rechazar y al expirar el plazo', () => {
    const { svc, store, clock } = setup();
    svc.save({ guildId: 'g', userId: 'u1', name: 'x', current: t('1'), pending: [] });
    let expired = false;
    const again = { guildId: 'g', userId: 'u1', name: 'x', current: t('1'), pending: [t('2')] };
    svc.save(again);
    expect(svc.confirmSave('g', 'u1', 'x', false)).toEqual({ status: 'cancelled', reason: 'rejected' });
    svc.save({ ...again, onExpire: () => (expired = true) });
    clock.advance(30_000);
    expect(expired).toBe(true);
    expect(svc.confirmSave('g', 'u1', 'x', true)).toEqual({ status: 'cancelled', reason: 'expired' });
    expect(store.listPlaylists('g', 'u1')[0]?.trackCount).toBe(1);
  });

  it('load añade al final de la Cola; nombre inexistente no la cambia', () => {
    const { svc } = setup();
    svc.save({ guildId: 'g', userId: 'u1', name: 'x', current: t('1'), pending: [t('2')] });
    const q = new Queue();
    q.add([t('0')]);
    expect(svc.load({ guildId: 'g', userId: 'u1', name: 'x', queue: q })).toMatchObject({ status: 'loaded', added: 2 });
    expect(q.pending.map((p) => p.id)).toEqual(['0', '1', '2']);
    expect(svc.load({ guildId: 'g', userId: 'u1', name: 'nope', queue: q }).status).toBe('not_found');
    expect(q.pending).toHaveLength(3);
  });

  it('delete: solo el creador; inexistente informa not_found', () => {
    const { svc, store } = setup();
    svc.save({ guildId: 'g', userId: 'u1', name: 'x', current: t('1'), pending: [] });
    expect(svc.delete({ guildId: 'g', userId: 'u2', name: 'x' }).status).toBe('not_creator');
    expect(store.listPlaylists('g', 'u1')).toHaveLength(1);
    expect(svc.delete({ guildId: 'g', userId: 'u1', name: 'zz' }).status).toBe('not_found');
    expect(svc.delete({ guildId: 'g', userId: 'u1', name: 'x' })).toEqual({ status: 'deleted', name: 'x' });
    expect(store.listPlaylists('g', 'u1')).toHaveLength(0);
  });
});

describe('VolumeService', () => {
  it('aplica y guarda, consulta y rechaza inválidos', () => {
    const store = new SqliteStore(':memory:');
    const calls: Array<[number, number]> = [];
    const svc = new VolumeService(store, (_g, v, p) => calls.push([v, p]));
    expect(svc.get('g')).toBe(50);
    expect(svc.set('g', 80)).toEqual({ status: 'applied', volume: 80 });
    expect(calls).toEqual([[80, 50]]);
    expect(svc.get('g')).toBe(80);
    for (const bad of [101, -1, 1.5, 'abc']) {
      expect(svc.set('g', bad)).toEqual({ status: 'invalid', min: 0, max: 100 });
    }
    expect(svc.get('g')).toBe(80);
    expect(calls).toHaveLength(1);
  });

  it('con fallo de guardado aplica y avisa not_saved', () => {
    const store = new SqliteStore(':memory:');
    store.setVolume = () => ({ ok: false, error: { kind: 'save_failed', message: 'x' } });
    let applied = -1;
    const svc = new VolumeService(store, (_g, v) => (applied = v));
    expect(svc.set('g', 20).status).toBe('not_saved');
    expect(applied).toBe(20);
  });
});

describe('DjService', () => {
  it('solo administradores pueden set/clear', () => {
    const store = new SqliteStore(':memory:');
    const dj = new DjService(store);
    expect(dj.set({ guildId: 'g', roleId: 'r', isAdmin: false }).status).toBe('forbidden');
    expect(dj.get('g')).toBeNull();
    expect(dj.set({ guildId: 'g', roleId: 'r', isAdmin: true })).toEqual({ status: 'set', roleId: 'r' });
    expect(dj.clear({ guildId: 'g', isAdmin: false }).status).toBe('forbidden');
    expect(dj.get('g')).toBe('r');
    expect(dj.clear({ guildId: 'g', isAdmin: true }).status).toBe('cleared');
    expect(dj.get('g')).toBeNull();
  });
});
