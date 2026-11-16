import { ok, err, type Result } from './result.js';

export const REQUIRED_ENV = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'] as const;

export interface Config {
  discordToken: string;
  clientId: string;
  /** Valores sensibles que deben redactarse de todo texto saliente. */
  secrets: string[];
}

export function loadConfig(
  env: Record<string, string | undefined>,
  required: readonly string[] = REQUIRED_ENV,
): Result<Config, { missing: string[] }> {
  const missing = required.filter((name) => {
    const v = env[name];
    return v === undefined || v === '';
  });
  if (missing.length > 0) return err({ missing });
  const discordToken = env['DISCORD_TOKEN'] as string;
  const clientId = env['DISCORD_CLIENT_ID'] as string;
  const secrets = required.map((n) => env[n] as string);
  return ok({ discordToken, clientId, secrets });
}

/** Mensaje para stderr con el nombre de cada variable ausente o vacía. */
export function formatMissingConfigMessage(missing: string[]): string {
  return `Configuración inválida. Variables de entorno ausentes o vacías: ${missing.join(', ')}`;
}

/** Carga la configuración o termina el proceso con código distinto de cero. */
export function loadConfigOrExit(
  env: Record<string, string | undefined>,
  exit: (code: number) => never = (c) => process.exit(c),
  writeErr: (s: string) => void = (s) => void process.stderr.write(s),
): Config {
  const r = loadConfig(env);
  if (!r.ok) {
    writeErr(formatMissingConfigMessage(r.error.missing) + '\n');
    return exit(1);
  }
  return r.value;
}
