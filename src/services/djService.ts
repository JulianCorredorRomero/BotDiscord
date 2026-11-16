import type { Store, StoreError } from '../store/store.js';

export type DjResult =
  | { status: 'set'; roleId: string }
  | { status: 'cleared' }
  | { status: 'forbidden' }
  | { status: 'store_error'; error: StoreError };

/** `/dj set|clear`: solo administradores (Req. 8.3, 8.4, 8.5). */
export class DjService {
  constructor(private readonly store: Store) {}

  get(guildId: string): string | null {
    return this.store.getDjRole(guildId);
  }

  set(args: { guildId: string; roleId: string; isAdmin: boolean }): DjResult {
    if (!args.isAdmin) return { status: 'forbidden' };
    const r = this.store.setDjRole(args.guildId, args.roleId);
    return r.ok ? { status: 'set', roleId: args.roleId } : { status: 'store_error', error: r.error };
  }

  clear(args: { guildId: string; isAdmin: boolean }): DjResult {
    if (!args.isAdmin) return { status: 'forbidden' };
    const r = this.store.setDjRole(args.guildId, null);
    return r.ok ? { status: 'cleared' } : { status: 'store_error', error: r.error };
  }
}
