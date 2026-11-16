import type { InteractionRouter } from '../router.js';
import { loopHandler, nowPlayingHandler, pauseHandler, resumeHandler, skipHandler, stopHandler, volumeHandler } from './controls.js';
import { djHandler } from './dj.js';
import { playHandler } from './play.js';
import { playlistHandler } from './playlist.js';
import { queueHandler, removeHandler, shuffleHandler } from './queueCommands.js';
import type { CommandDeps } from './shared.js';

export type { CommandDeps } from './shared.js';

/** Registra los 13 manejadores de comandos en el router. */
export function registerCommands(router: InteractionRouter, deps: CommandDeps): InteractionRouter {
  return router
    .register('play', playHandler(deps))
    .register('pause', pauseHandler(deps))
    .register('resume', resumeHandler(deps))
    .register('skip', skipHandler(deps))
    .register('stop', stopHandler(deps))
    .register('nowplaying', nowPlayingHandler(deps))
    .register('queue', queueHandler(deps))
    .register('loop', loopHandler(deps))
    .register('shuffle', shuffleHandler(deps))
    .register('remove', removeHandler(deps))
    .register('volume', volumeHandler(deps))
    .register('playlist', playlistHandler(deps))
    .register('dj', djHandler(deps));
}
