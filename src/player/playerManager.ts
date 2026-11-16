import { GuildPlayer, type GuildPlayerDeps } from './guildPlayer.js';

/** Construye las dependencias propias de un Servidor (no deben compartir estado mutable entre Servidores). */
export type GuildPlayerDepsFactory = (guildId: string) => GuildPlayerDeps;

/**
 * Registro `guildId -> GuildPlayer`. Crea reproductores bajo demanda y los retira
 * cuando se liberan (`onReleased`) o se destruyen. No guarda más estado que el mapa.
 */
export class PlayerManager {
  private readonly players = new Map<string, GuildPlayer>();

  constructor(private readonly depsFor: GuildPlayerDepsFactory) {}

  get size(): number {
    return this.players.size;
  }

  get(guildId: string): GuildPlayer | undefined {
    return this.players.get(guildId);
  }

  getOrCreate(guildId: string): GuildPlayer {
    const existing = this.players.get(guildId);
    if (existing) return existing;

    const base = this.depsFor(guildId);
    const player: GuildPlayer = new GuildPlayer({
      ...base,
      guildId,
      onReleased: () => {
        base.onReleased?.();
        // Solo retira la entrada si sigue siendo este reproductor (evita borrar uno nuevo).
        if (this.players.get(guildId) === player) {
          this.players.delete(guildId);
          player.dispose();
        }
      },
    });
    this.players.set(guildId, player);
    return player;
  }

  /** Libera y elimina el reproductor del Servidor. Devuelve false si no existía. */
  destroy(guildId: string): boolean {
    const player = this.players.get(guildId);
    if (!player) return false;
    this.players.delete(guildId);
    player.dispose();
    return true;
  }

  destroyAll(): void {
    const all = [...this.players.values()];
    this.players.clear();
    for (const p of all) p.dispose();
  }
}
