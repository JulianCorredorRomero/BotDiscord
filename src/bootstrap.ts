import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  Client,
  GatewayIntentBits,
  OAuth2Scopes,
  PermissionFlagsBits,
  REST,
  Routes,
  type ClientOptions,
  type Interaction,
} from 'discord.js';
import { AudioPipeline } from './audio/audioPipeline.js';
import { RealClock, type Clock } from './core/clock.js';
import type { Config } from './core/config.js';
import { I18n, type MessageKey } from './core/i18n.js';
import { Logger } from './core/logger.js';
import { RateLimiter } from './core/rateLimiter.js';
import type { Track } from './core/types.js';
import { registerCommands } from './discord/commands/index.js';
import { buildCommandDefinitions } from './discord/commandDefinitions.js';
import { fromChatInput, registerInteractionHandlers } from './discord/discordAdapter.js';
import { Guard } from './discord/guard.js';
import {
  NowPlayingMessage,
  buildNowPlayingModel,
  renderNowPlaying,
  type NowPlayingChannelPort,
  type NowPlayingModel,
} from './discord/nowPlayingMessage.js';
import { InteractionRouter } from './discord/router.js';
import { PlayerManager } from './player/playerManager.js';
import type { Notifier, PipelineFactory, PlayerNotice, VoiceConnector } from './player/ports.js';
import { DiscordVoiceConnector } from './player/voiceSession.js';
import { Resolver, createYtDlpRunner } from './resolver/resolver.js';
import { DjService } from './services/djService.js';
import { PlaylistService } from './services/playlistService.js';
import { VolumeService } from './services/volumeService.js';
import { SqliteStore, type Store } from './store/store.js';

// ---------------------------------------------------------------------------
// Intents y permisos (Req. 8.8)
// ---------------------------------------------------------------------------

/** Intents mínimos del cliente. */
export const BOT_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] as const;

/** Permisos solicitados al invitar al Bot: Connect, Speak, Send Messages y Embed Links. */
export const BOT_PERMISSIONS: bigint =
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks;

export function createClientOptions(): ClientOptions {
  return { intents: [...BOT_INTENTS] };
}

/** URL de invitación OAuth2 con los scopes `bot` y `applications.commands`. */
export function buildInviteUrl(clientId: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('permissions', BOT_PERMISSIONS.toString());
  url.searchParams.set('scope', [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '));
  return url.toString();
}

// ---------------------------------------------------------------------------
// Registro de slash commands (Req. 9.9, 9.10)
// ---------------------------------------------------------------------------

export const REGISTER_MAX_RETRIES = 3;
export const REGISTER_RETRY_DELAY_MS = 10_000;
export const REGISTER_TIMEOUT_MS = 60_000;

export interface RestPort {
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

export type RegistrationResult =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; error: string }
  | { ok: false; attempts: number; error: 'aborted' };

export interface RegisterOptions {
  rest: RestPort;
  clientId: string;
  /** Si se indica, los comandos se registran solo en ese Servidor; si no, de forma global. */
  guildId?: string;
  commands: unknown[];
  clock: Clock;
  logger: Logger;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  isAborted?: () => boolean;
}

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => void clock.setTimeout(resolve, ms));
}

function withClockTimeout<T>(p: Promise<T>, clock: Clock, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = clock.setTimeout(() => reject(new Error(`registro sin completar en ${ms} ms`)), ms);
    p.then(
      (v) => {
        clock.clearTimeout(h);
        resolve(v);
      },
      (e: unknown) => {
        clock.clearTimeout(h);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Registra los slash commands. Un intento inicial y hasta 3 reintentos separados 10 s;
 * cada fallo se registra con su causa. No lanza.
 */
export async function registerSlashCommands(opts: RegisterOptions): Promise<RegistrationResult> {
  const retries = opts.maxRetries ?? REGISTER_MAX_RETRIES;
  const delay = opts.retryDelayMs ?? REGISTER_RETRY_DELAY_MS;
  const timeout = opts.timeoutMs ?? REGISTER_TIMEOUT_MS;
  const total = 1 + retries;
  const route = opts.guildId
    ? Routes.applicationGuildCommands(opts.clientId, opts.guildId)
    : Routes.applicationCommands(opts.clientId);

  let lastError = '';
  for (let attempt = 1; attempt <= total; attempt++) {
    if (opts.isAborted?.()) return { ok: false, attempts: attempt - 1, error: 'aborted' };
    try {
      await withClockTimeout(opts.rest.put(route, { body: opts.commands }), opts.clock, timeout);
      opts.logger.log(
        'commands_registered',
        `scope=${opts.guildId ? 'guild' : 'global'} count=${opts.commands.length} attempt=${attempt}`,
      );
      return { ok: true, attempts: attempt };
    } catch (e) {
      lastError = describeError(e);
      opts.logger.log('command_registration_failed', `attempt=${attempt}/${total} cause=${lastError}`);
      if (attempt < total) await sleep(opts.clock, delay);
    }
  }
  opts.logger.log('command_registration_gave_up', `attempts=${total} cause=${lastError}`);
  return { ok: false, attempts: total, error: opts.logger.redact(lastError) };
}

// ---------------------------------------------------------------------------
// Puertos mínimos del cliente discord.js (permiten sustituirlo en pruebas)
// ---------------------------------------------------------------------------

export interface MessagePayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

export interface TextChannelLike {
  isTextBased(): boolean;
  send(payload: MessagePayload): Promise<{ id: string }>;
  messages: { edit(messageId: string, payload: MessagePayload): Promise<unknown> };
}

export interface VoiceStateLike {
  id: string;
  channelId: string | null;
  guild: { id: string };
  channel?: {
    members: { filter(fn: (m: { user: { bot: boolean } }) => boolean): { size: number } };
  } | null;
}

export interface BotClientPort {
  on(event: 'interactionCreate', listener: (i: Interaction) => void): unknown;
  on(event: 'voiceStateUpdate', listener: (oldState: VoiceStateLike, newState: VoiceStateLike) => void): unknown;
  login(token: string): Promise<unknown>;
  destroy(): Promise<void> | void;
  user: { id: string } | null;
  channels: { fetch(id: string): Promise<TextChannelLike | null> };
}

// ---------------------------------------------------------------------------
// startBot
// ---------------------------------------------------------------------------

export interface BotDeps {
  config: Config;
  client: BotClientPort;
  rest: RestPort;
  clock: Clock;
  logger: Logger;
  store: Store;
  resolver: Pick<Resolver, 'resolve' | 'searchSuggestions'>;
  /** Fábrica de pipelines de audio (normalmente un `AudioPipeline`). */
  audio: PipelineFactory;
  connectorFor: (guildId: string) => VoiceConnector;
  /** Registro por Servidor si se indica (p. ej. DISCORD_GUILD_ID); global en otro caso. */
  guildId?: string;
  retryDelayMs?: number;
  registerTimeoutMs?: number;
  i18n?: I18n;
}

export interface BotHandle {
  /** Resultado del registro de comandos (no bloquea la recepción de comandos). */
  registration: Promise<RegistrationResult>;
  /** Destruye reproductores, cierra el Almacén y el cliente. Idempotente. */
  stop(): Promise<void>;
}

interface GuildMessageState {
  np: NowPlayingMessage;
  channelId: string;
  lastTrack: Track | null;
  finished: boolean;
}

export async function startBot(deps: BotDeps): Promise<BotHandle> {
  const { client, clock, logger, store } = deps;
  const i18n = deps.i18n ?? new I18n();
  const textChannels = new Map<string, string>();
  const messages = new Map<string, GuildMessageState>();
  let stopped = false;

  const langOf = (guildId: string): string | undefined => {
    try {
      return store.getLanguage(guildId);
    } catch {
      return undefined;
    }
  };

  // --- Canal de texto -------------------------------------------------------
  const send = async (channelId: string, payload: MessagePayload): Promise<string> => {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) throw new Error('canal de texto no disponible');
    return (await ch.send(payload)).id;
  };
  const portFor = (channelId: string): NowPlayingChannelPort => ({
    send: (model: NowPlayingModel) => send(channelId, renderNowPlaying(model)),
    edit: async (messageId, model) => {
      const ch = await client.channels.fetch(channelId);
      if (!ch || !ch.isTextBased()) throw new Error('canal de texto no disponible');
      await ch.messages.edit(messageId, renderNowPlaying(model));
    },
  });

  const stateFor = (guildId: string): GuildMessageState | null => {
    const channelId = textChannels.get(guildId);
    if (!channelId) return null;
    const existing = messages.get(guildId);
    if (existing && existing.channelId === channelId) return existing;
    const created: GuildMessageState = {
      np: new NowPlayingMessage(portFor(channelId)),
      channelId,
      lastTrack: existing?.lastTrack ?? null,
      finished: false,
    };
    messages.set(guildId, created);
    return created;
  };

  // --- Mensaje_de_Reproducción ---------------------------------------------
  const announceTrack = async (guildId: string): Promise<void> => {
    const player = players.get(guildId);
    const track = player?.queue.current;
    const st = stateFor(guildId);
    if (!player || !track || !st) return;
    st.lastTrack = track;
    st.finished = false;
    await st.np.post(buildNowPlayingModel(track, track.requestedBy, 'reproduciendo', player.loop, player.currentVolume));
  };

  const finishMessage = async (guildId: string): Promise<void> => {
    const st = messages.get(guildId);
    if (!st || st.finished || !st.lastTrack) return;
    st.finished = true;
    const t = st.lastTrack;
    let volume = 50;
    try {
      volume = store.getVolume(guildId);
    } catch {
      /* usa el valor por defecto */
    }
    await st.np.finish(t, t.requestedBy, players.get(guildId)?.loop ?? 'off', volume);
  };

  /** Actualiza el mensaje tras un cambio de estado; lo cierra si ya no hay reproducción. */
  const refreshMessage = async (guildId: string): Promise<void> => {
    try {
      const st = messages.get(guildId);
      if (!st || st.finished) return;
      const player = players.get(guildId);
      const np = player?.nowPlaying();
      if (!player || !np || !np.ok) {
        await finishMessage(guildId);
        return;
      }
      const { track, state, loop, volume } = np.value;
      st.lastTrack = track;
      await st.np.update(buildNowPlayingModel(track, track.requestedBy, state, loop, volume));
    } catch (e) {
      logger.log('now_playing_update_failed', describeError(e), guildId);
    }
  };

  // --- Notificador por Servidor --------------------------------------------
  const noticeText = (guildId: string, n: PlayerNotice): string => {
    const lang = langOf(guildId);
    switch (n.type) {
      case 'track_failed':
        return i18n.t('notice.track_failed', lang, {
          title: n.title,
          reason: i18n.t(`notice.reason.${n.reason}` as MessageKey, lang),
        });
      case 'queue_finished':
        return i18n.t('notice.queue_finished', lang);
      case 'session_destroyed':
        return i18n.t('notice.session_destroyed', lang);
      case 'disconnected':
        return i18n.t(`notice.disconnected_${n.reason}` as MessageKey, lang);
      case 'queue_cleared':
        return i18n.t('notice.queue_cleared', lang);
      case 'moved':
        return i18n.t('notice.moved', lang, { channelId: n.channelId });
    }
  };

  const notifierFor = (guildId: string): Notifier => ({
    notify(n) {
      void (async () => {
        try {
          const channelId = textChannels.get(guildId);
          if (channelId) await send(channelId, { content: logger.redact(noticeText(guildId, n)) });
          if (n.type === 'queue_finished' || n.type === 'disconnected' || n.type === 'queue_cleared') {
            await finishMessage(guildId);
          }
        } catch (e) {
          logger.log('notice_failed', `type=${n.type} cause=${describeError(e)}`, guildId);
        }
      })();
    },
  });

  // --- Reproductores y servicios -------------------------------------------
  const players: PlayerManager = new PlayerManager((guildId) => ({
    guildId,
    clock,
    connector: deps.connectorFor(guildId),
    pipelines: {
      async start(req) {
        const handle = await deps.audio.start(req);
        void announceTrack(guildId).catch((e: unknown) =>
          logger.log('now_playing_failed', describeError(e), guildId),
        );
        return handle;
      },
    },
    notifier: notifierFor(guildId),
    store,
  }));

  const guard = new Guard({
    rateLimiter: new RateLimiter(clock),
    store,
    i18n,
    getBotVoiceChannelId: (guildId) => players.get(guildId)?.voiceChannelId ?? null,
  });
  const router = new InteractionRouter({ guard, logger, i18n, clock, store });
  registerCommands(router, {
    resolver: deps.resolver,
    players,
    store,
    playlists: new PlaylistService(store, clock),
    // Con reproductor activo el volumen lo aplica GuildPlayer; sin él solo se guarda.
    volume: new VolumeService(store, () => undefined),
    dj: new DjService(store),
    i18n,
  });

  // --- Cableado de eventos --------------------------------------------------
  client.on('interactionCreate', (i) => {
    if (!i.isChatInputCommand()) return;
    if (i.guildId && i.channelId) textChannels.set(i.guildId, i.channelId);
    const guildId = i.guildId;
    void router
      .handle(fromChatInput(i))
      .catch((e: unknown) => logger.log('interaction_failed', describeError(e), guildId))
      .then(() => (guildId ? refreshMessage(guildId) : undefined));
  });

  registerInteractionHandlers(client, {
    buttons: { guard, players, store, i18n, onPlaybackChanged: refreshMessage },
    autocomplete: { resolver: deps.resolver },
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    try {
      const guildId = newState.guild.id;
      const player = players.get(guildId);
      if (!player) return;
      const botId = client.user?.id;
      if (botId && newState.id === botId) {
        const moved = newState.channelId !== null && newState.channelId !== player.voiceChannelId;
        const left = newState.channelId === null && player.connected;
        if (moved || left) player.notifyBotChannelChange(oldState.channelId, newState.channelId);
        return;
      }
      const cid = player.voiceChannelId;
      if (!cid || (oldState.channelId !== cid && newState.channelId !== cid)) return;
      const ch = newState.channelId === cid ? newState.channel : oldState.channel;
      if (ch) player.notifyHumanCount(ch.members.filter((m) => !m.user.bot).size);
    } catch (e) {
      logger.log('voice_state_failed', describeError(e), newState.guild.id);
    }
  });

  // --- Inicio de sesión y registro -----------------------------------------
  try {
    await client.login(deps.config.discordToken);
  } catch (e) {
    logger.log('login_failed', describeError(e));
    throw new Error(logger.redact(`No se pudo iniciar sesión en Discord: ${describeError(e)}`));
  }
  logger.log('bot_started', `clientId=${deps.config.clientId}`);

  const registration = registerSlashCommands({
    rest: deps.rest,
    clientId: deps.config.clientId,
    guildId: deps.guildId,
    commands: buildCommandDefinitions(),
    clock,
    logger,
    retryDelayMs: deps.retryDelayMs,
    timeoutMs: deps.registerTimeoutMs,
    isAborted: () => stopped,
  });

  return {
    registration,
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        players.destroyAll();
      } catch (e) {
        logger.log('shutdown_error', `players: ${describeError(e)}`);
      }
      try {
        store.close();
      } catch (e) {
        logger.log('shutdown_error', `store: ${describeError(e)}`);
      }
      try {
        await client.destroy();
      } catch (e) {
        logger.log('shutdown_error', `client: ${describeError(e)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Dependencias reales
// ---------------------------------------------------------------------------

/** Construye las dependencias de producción a partir de la configuración y el entorno. */
export function createRuntime(config: Config, env: Record<string, string | undefined>): BotDeps {
  const clock = new RealClock();
  const logger = new Logger(config.secrets);
  const dbPath = env['DATABASE_PATH'] || 'data/bot.sqlite';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteStore(dbPath);
  const client = new Client(createClientOptions());
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  return {
    config,
    client: client as unknown as BotClientPort,
    rest: rest as unknown as RestPort,
    clock,
    logger,
    store,
    resolver: new Resolver(createYtDlpRunner(env['YTDLP_PATH'] || 'yt-dlp')),
    audio: new AudioPipeline({
      clock,
      ffmpegPath: env['FFMPEG_PATH'] || undefined,
      ytDlpPath: env['YTDLP_PATH'] || undefined,
    }),
    connectorFor: (guildId) => {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) throw new Error(`Servidor ${guildId} no disponible en caché`);
      return new DiscordVoiceConnector(guild);
    },
    guildId: env['DISCORD_GUILD_ID'] || undefined,
  };
}
