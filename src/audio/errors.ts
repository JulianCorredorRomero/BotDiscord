/** Errores tipados del pipeline de audio. */
export type AudioErrorKind = 'download_failed' | 'ffmpeg_failed';

export class AudioError extends Error {
  constructor(
    readonly kind: AudioErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AudioError';
  }
}

export function isAudioError(e: unknown): e is AudioError {
  return e instanceof AudioError;
}
