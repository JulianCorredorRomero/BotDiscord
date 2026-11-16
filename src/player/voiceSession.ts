import type { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { PermissionFlagsBits, type Guild, type VoiceBasedChannel } from 'discord.js';
import type {
  VoiceConnector,
  VoicePermissions,
  VoiceSession,
  VoiceSessionListener,
} from './ports.js';

const CONNECT_TIMEOUT_MS = 10_000;
const MOVE_DETECT_MS = 5_000;
const RECONNECT_READY_MS = 5_000;
const WS_CLOSE_DISCONNECTED = 4014;

function voiceChannel(guild: Guild, channelId: string): VoiceBasedChannel | null {
  const ch = guild.channels.cache.get(channelId);
  return ch && ch.isVoiceBased() ? ch : null;
}

/** Adaptador real de `VoiceSession` sobre @discordjs/voice. */
export class DiscordVoiceSession implements VoiceSession {
  private listener: VoiceSessionListener | null = null;
  private destroyed = false;
  private currentChannelId: string;

  constructor(
    private readonly guild: Guild,
    private readonly connection: VoiceConnection,
    private readonly player: AudioPlayer,
    channelId: string,
  ) {
    this.currentChannelId = channelId;
    connection.subscribe(player);
    player.on(AudioPlayerStatus.Idle, () => {
      if (!this.destroyed) this.listener?.onTrackEnd();
    });
    player.on('error', (e) => {
      if (!this.destroyed) this.listener?.onPlayerError(e);
    });
    connection.on(VoiceConnectionStatus.Disconnected, (_old, news) => {
      const closeCode = 'closeCode' in news ? (news as { closeCode: number }).closeCode : undefined;
      void this.handleDisconnected(closeCode);
    });
  }

  get channelId(): string {
    return this.currentChannelId;
  }

  get channelBitrateKbps(): number {
    const ch = voiceChannel(this.guild, this.currentChannelId);
    return ch ? Math.max(8, Math.floor(ch.bitrate / 1000)) : 64;
  }

  humanCount(): number {
    const ch = voiceChannel(this.guild, this.currentChannelId);
    return ch ? ch.members.filter((m) => !m.user.bot).size : 0;
  }

  setListener(listener: VoiceSessionListener): void {
    this.listener = listener;
  }

  play(stream: Readable): void {
    this.player.play(createAudioResource(stream, { inputType: StreamType.OggOpus }));
  }

  pause(): void {
    this.player.pause(true);
  }

  unpause(): void {
    this.player.unpause();
  }

  stopOutput(): void {
    this.player.stop(true);
  }

  async reconnect(): Promise<boolean> {
    try {
      if (this.connection.state.status === VoiceConnectionStatus.Destroyed) return false;
      this.connection.rejoin();
      await entersState(this.connection, VoiceConnectionStatus.Ready, RECONNECT_READY_MS);
      this.connection.subscribe(this.player);
      return true;
    } catch {
      return false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.player.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
  }

  /** Distingue movimiento (el estado vuelve a Signalling/Connecting), desconexión manual y caída. */
  private async handleDisconnected(closeCode: number | undefined): Promise<void> {
    if (this.destroyed) return;
    const old = this.currentChannelId;
    if (closeCode === WS_CLOSE_DISCONNECTED) {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, MOVE_DETECT_MS),
          entersState(this.connection, VoiceConnectionStatus.Connecting, MOVE_DETECT_MS),
        ]);
        const moved = this.connection.joinConfig.channelId;
        if (moved && moved !== old) {
          this.currentChannelId = moved;
          this.listener?.onBotChannelChange(old, moved);
        }
      } catch {
        if (!this.destroyed) this.listener?.onBotChannelChange(old, null);
      }
      return;
    }
    this.listener?.onInterrupted();
  }
}

/** Adaptador real de `VoiceConnector` para un Servidor de discord.js. */
export class DiscordVoiceConnector implements VoiceConnector {
  constructor(private readonly guild: Guild) {}

  checkPermissions(channelId: string): VoicePermissions {
    const ch = voiceChannel(this.guild, channelId);
    const me = this.guild.members.me;
    const perms = ch && me ? ch.permissionsFor(me) : null;
    return {
      connect: perms?.has(PermissionFlagsBits.Connect) ?? false,
      speak: perms?.has(PermissionFlagsBits.Speak) ?? false,
    };
  }

  async connect(channelId: string): Promise<VoiceSession> {
    const connection = joinVoiceChannel({
      channelId,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
    } catch (e) {
      connection.destroy();
      throw e;
    }
    return new DiscordVoiceSession(this.guild, connection, createAudioPlayer(), channelId);
  }
}
