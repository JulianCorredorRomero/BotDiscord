import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import { err, ok } from '../../src/core/result.js';

describe('FakeClock', () => {
  it('runs timers in order when advancing', () => {
    const c = new FakeClock(1000);
    const calls: string[] = [];
    c.setTimeout(() => calls.push('b'), 200);
    c.setTimeout(() => calls.push('a'), 100);
    c.advance(150);
    expect(calls).toEqual(['a']);
    expect(c.now()).toBe(1150);
    c.advance(100);
    expect(calls).toEqual(['a', 'b']);
  });

  it('does not run cleared timers', () => {
    const c = new FakeClock();
    let n = 0;
    const h = c.setTimeout(() => n++, 10);
    c.clearTimeout(h);
    c.advance(100);
    expect(n).toBe(0);
  });
});

describe('Result helpers', () => {
  it('builds ok and err values', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
  });
});
