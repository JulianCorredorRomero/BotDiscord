import { formatDuration, MAX_SUGGESTIONS, truncateSuggestion } from '../core/volume-format.js';
import type { Track } from '../core/types.js';
import type { Resolver } from '../resolver/resolver.js';

export interface AutocompleteChoice {
  name: string;
  value: string;
}

/** Interacción de autocompletado de /play. */
export interface AutocompleteContext {
  commandName: string;
  focusedName: string;
  query: string;
  respond(choices: AutocompleteChoice[]): Promise<void>;
}

export interface AutocompleteDeps {
  resolver: Pick<Resolver, 'searchSuggestions'>;
  /** Plazo máximo (Req. 6.12: 3 s). */
  timeoutMs?: number;
}

const DISCORD_CHOICE_MAX = 100;

export function toChoice(track: Pick<Track, 'title' | 'durationSec' | 'url'>): AutocompleteChoice | null {
  const suffix = ` (${formatDuration(track.durationSec)})`;
  const title = truncateSuggestion(track.title, DISCORD_CHOICE_MAX - Array.from(suffix).length);
  if (Array.from(track.url).length > DISCORD_CHOICE_MAX) return null;
  return { name: `${title}${suffix}`, value: track.url };
}

/** Sugerencias para `query`: ≤5, [] ante falta de resultados, fallo o plazo agotado. */
export async function getSuggestions(deps: AutocompleteDeps, query: string): Promise<AutocompleteChoice[]> {
  const timeoutMs = deps.timeoutMs ?? 3000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const tracks = await Promise.race([
      deps.resolver.searchSuggestions(query),
      new Promise<Track[]>((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      }),
    ]);
    const out: AutocompleteChoice[] = [];
    for (const t of tracks) {
      const c = toChoice(t);
      if (c) out.push(c);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Nunca lanza ni interrumpe /play. Devuelve true si la interacción era de /play query. */
export async function handleAutocomplete(deps: AutocompleteDeps, ctx: AutocompleteContext): Promise<boolean> {
  if (ctx.commandName !== 'play' || ctx.focusedName !== 'query') return false;
  const choices = await getSuggestions(deps, ctx.query);
  try {
    await ctx.respond(choices);
  } catch {
    /* interacción expirada: ignorar */
  }
  return true;
}
