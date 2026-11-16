import { loadConfigOrExit } from './core/config.js';
import { createRuntime, startBot, buildInviteUrl } from './bootstrap.js';

// Sin variables obligatorias el proceso termina aquí (código 1) sin conectar a Discord.
const config = loadConfigOrExit(process.env);

async function main(): Promise<void> {
  const runtime = createRuntime(config, process.env);
  const handle = await startBot(runtime);
  runtime.logger.log('invite_url', buildInviteUrl(config.clientId));

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime.logger.log('shutdown', `signal=${signal}`);
    void handle.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  void handle.registration.then((r) => {
    if (!r.ok) runtime.logger.log('commands_unavailable', `El registro de comandos falló: ${r.error}`);
  });
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  // El mensaje ya viene redactado por startBot; se vuelve a filtrar por seguridad.
  let out = msg;
  for (const s of config.secrets) if (s) out = out.split(s).join('');
  process.stderr.write(`Error fatal: ${out}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  let out = msg;
  for (const s of config.secrets) if (s) out = out.split(s).join('');
  process.stderr.write(`unhandledRejection: ${out}\n`);
});
