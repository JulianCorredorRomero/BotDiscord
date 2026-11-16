import type { Clock } from '../core/clock.js';
import { AudioError } from './errors.js';

export const DOWNLOAD_RETRIES = 3;
export const DOWNLOAD_RETRY_DELAY_MS = 2000;

export type RetryResult<T> =
  | { ok: true; value: T; failures: number }
  | { ok: false; error: AudioError; failures: number };

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms);
  });
}

/**
 * Ejecuta `attempt` una vez y, si falla, la reintenta hasta `retries` veces
 * separando los intentos `delayMs`. Con k fallos consecutivos: éxito si k <= retries,
 * error `download_failed` si k > retries (1 + retries fallos).
 */
export async function withDownloadRetries<T>(
  attempt: () => Promise<T>,
  clock: Clock,
  retries = DOWNLOAD_RETRIES,
  delayMs = DOWNLOAD_RETRY_DELAY_MS,
): Promise<RetryResult<T>> {
  let failures = 0;
  let last: unknown;
  for (;;) {
    try {
      const value = await attempt();
      return { ok: true, value, failures };
    } catch (e) {
      last = e;
      failures++;
      if (failures > retries) break;
      await sleep(clock, delayMs);
    }
  }
  return {
    ok: false,
    failures,
    error: new AudioError('download_failed', `Descarga fallida tras ${failures} intentos`, last),
  };
}
