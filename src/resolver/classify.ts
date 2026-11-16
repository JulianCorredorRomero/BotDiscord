export type InputKind = 'video_url' | 'playlist_url' | 'search' | 'invalid_url';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,}$/;

const MAX_SEARCH_LENGTH = 100;

function looksLikeUrl(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^www\./i.test(s);
}

/**
 * Clasifica la entrada de /play.
 * - URL de YouTube de vídeo -> `video_url`; de lista -> `playlist_url`.
 * - Cualquier otra URL -> `invalid_url`.
 * - Texto que no es URL de 1..100 caracteres -> `search`.
 * - Texto vacío o de más de 100 caracteres -> `invalid_url`.
 */
export function classifyInput(input: string): InputKind {
  const text = input.trim();
  if (text.length === 0) return 'invalid_url';

  if (!looksLikeUrl(text)) {
    return text.length <= MAX_SEARCH_LENGTH ? 'search' : 'invalid_url';
  }

  let url: URL;
  try {
    url = new URL(/^www\./i.test(text) ? `https://${text}` : text);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid_url';

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return 'invalid_url';

  const segments = url.pathname.split('/').filter((s) => s.length > 0);

  if (host.endsWith('youtu.be')) {
    return segments.length === 1 && VIDEO_ID.test(segments[0]!) ? 'video_url' : 'invalid_url';
  }

  const first = segments[0];
  if (first === 'watch' && segments.length === 1) {
    const v = url.searchParams.get('v');
    if (v !== null && VIDEO_ID.test(v)) return 'video_url';
    return 'invalid_url';
  }
  if (first === 'playlist' && segments.length === 1) {
    const list = url.searchParams.get('list');
    return list !== null && PLAYLIST_ID.test(list) ? 'playlist_url' : 'invalid_url';
  }
  if (
    (first === 'shorts' || first === 'live' || first === 'embed' || first === 'v') &&
    segments.length === 2 &&
    VIDEO_ID.test(segments[1]!)
  ) {
    return 'video_url';
  }
  return 'invalid_url';
}
