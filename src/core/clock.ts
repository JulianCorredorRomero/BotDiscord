export type TimerHandle = number;

/** Reloj y temporizadores inyectables para pruebas deterministas. */
export interface Clock {
  /** Tiempo actual en milisegundos. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export class RealClock implements Clock {
  private timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  private nextId = 1;

  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        fn();
      }, ms),
    );
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    const t = this.timers.get(handle);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(handle);
    }
  }
}

interface PendingTimer {
  at: number;
  seq: number;
  fn: () => void;
}

export class FakeClock implements Clock {
  private current: number;
  private nextId = 1;
  private timers = new Map<TimerHandle, PendingTimer>();

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + Math.max(0, ms), seq: id, fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle);
  }

  /** Avanza el tiempo ejecutando en orden los temporizadores que vencen. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let nextEntry: [TimerHandle, PendingTimer] | undefined;
      for (const entry of this.timers) {
        const [, t] = entry;
        if (t.at > target) continue;
        if (!nextEntry || t.at < nextEntry[1].at || (t.at === nextEntry[1].at && t.seq < nextEntry[1].seq)) {
          nextEntry = entry;
        }
      }
      if (!nextEntry) break;
      this.timers.delete(nextEntry[0]);
      this.current = Math.max(this.current, nextEntry[1].at);
      nextEntry[1].fn();
    }
    this.current = target;
  }

  /** Fija el tiempo sin ejecutar temporizadores. */
  set(ms: number): void {
    this.current = ms;
  }

  get pendingTimers(): number {
    return this.timers.size;
  }
}
