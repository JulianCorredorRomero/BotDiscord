import { parseVolumeArg } from '../core/volume-format.js';
import type { Store, StoreError } from '../store/store.js';

/** Aplica el volumen a la reproducción en curso (rampa de 300 ms en el Procesador_de_Audio). */
export type VolumeApplier = (guildId: string, volume: number, previous: number) => void;

export type VolumeSetResult =
  | { status: 'applied'; volume: number }
  | { status: 'not_saved'; volume: number; error: StoreError }
  | { status: 'invalid'; min: 0; max: 100 };

export class VolumeService {
  constructor(
    private readonly store: Store,
    private readonly apply: VolumeApplier,
  ) {}

  /** `/volume` sin valor (Req. 3.2). */
  get(guildId: string): number {
    return this.store.getVolume(guildId);
  }

  /** `/volume valor`. Un fallo de guardado aplica igualmente el volumen (Req. 3.6). */
  set(guildId: string, raw: unknown): VolumeSetResult {
    const parsed = parseVolumeArg(raw);
    if (!parsed.ok) return { status: 'invalid', min: 0, max: 100 };
    const volume = parsed.value;
    const previous = this.store.getVolume(guildId);
    this.apply(guildId, volume, previous);
    const saved = this.store.setVolume(guildId, volume);
    if (!saved.ok) return { status: 'not_saved', volume, error: saved.error };
    return { status: 'applied', volume };
  }
}
