export interface LogEvent {
  at: Date;
  type: string;
  description?: string;
  guildId?: string | null;
}

/** Elimina toda aparición de cada secreto no vacío (también dentro de otras cadenas). */
export function redactSecrets(text: string, secrets: string[]): string {
  // Los más largos primero para que un secreto contenido en otro no deje restos.
  const list = secrets.filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  let out = text;
  let changed = true;
  // Repetir: la eliminación puede unir fragmentos que formen un secreto.
  while (changed) {
    changed = false;
    for (const s of list) {
      if (out.includes(s)) {
        out = out.split(s).join('');
        changed = true;
      }
    }
  }
  return out;
}

export function formatLogEntry(e: LogEvent): string {
  const guild = e.guildId === undefined || e.guildId === null || e.guildId === '' ? 'ninguno' : e.guildId;
  const parts = [e.at.toISOString(), e.type, `guildId=${guild}`];
  if (e.description !== undefined && e.description !== '') parts.push(e.description);
  return parts.join(' | ');
}

export class Logger {
  constructor(
    private readonly secrets: string[] = [],
    private readonly sink: (line: string) => void = (l) => console.log(l),
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(type: string, description?: string, guildId?: string | null): string {
    const line = redactSecrets(
      formatLogEntry({ at: this.now(), type, description, guildId }),
      this.secrets,
    );
    this.sink(line);
    return line;
  }

  redact(text: string): string {
    return redactSecrets(text, this.secrets);
  }
}
