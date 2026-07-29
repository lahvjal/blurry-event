const SAMPLE_RATE = 44_100;
const CLICK_DURATION_SECONDS = 0.034;
const PLAYER_COUNT = 4;
const CLICK_VOLUME = 0.55;

let clickUrl: string | null = null;
let players: HTMLAudioElement[] | null = null;
let nextPlayer = 0;
let isPrepared = false;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/**
 * Builds a tiny PCM WAV in memory. A short low knock under a brighter noise
 * transient makes the detent audible through a phone speaker without sounding
 * like a notification or requiring an asset download.
 */
function createClickUrl(): string {
  if (clickUrl) return clickUrl;

  const sampleCount = Math.ceil(SAMPLE_RATE * CLICK_DURATION_SECONDS);
  const bytesPerSample = 2;
  const wav = new ArrayBuffer(44 + sampleCount * bytesPerSample);
  const view = new DataView(wav);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, sampleCount * bytesPerSample, true);

  for (let i = 0; i < sampleCount; i += 1) {
    const time = i / SAMPLE_RATE;
    const attack = Math.min(1, time / 0.0007);
    const decay = Math.exp(-time / 0.0075);
    const noise = Math.random() * 2 - 1;
    const knock =
      Math.sin(2 * Math.PI * 720 * time) * 0.7 +
      Math.sin(2 * Math.PI * 1240 * time) * 0.3;
    const sample = Math.max(
      -1,
      Math.min(1, (noise * 0.52 + knock * 0.48) * attack * decay * 0.82),
    );
    view.setInt16(44 + i * bytesPerSample, sample * 0x7fff, true);
  }

  clickUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  return clickUrl;
}

function getPlayers(): HTMLAudioElement[] {
  if (players) return players;

  const url = createClickUrl();
  players = Array.from({ length: PLAYER_COUNT }, () => {
    const player = new Audio(url);
    player.preload = 'auto';
    player.volume = CLICK_VOLUME;
    player.setAttribute('playsinline', '');
    player.load();
    return player;
  });
  return players;
}

/**
 * iOS requires media playback to be unlocked by a direct touch. Prime every
 * player silently as soon as the finger lands so later dial detents can replay
 * immediately during the drag.
 */
export function prepareScoreDialAudio(): void {
  if (isPrepared) return;
  isPrepared = true;

  for (const player of getPlayers()) {
    player.muted = true;
    const playback = player.play();
    if (!playback) {
      player.pause();
      player.currentTime = 0;
      player.muted = false;
      continue;
    }
    void playback
      .then(() => {
        player.pause();
        player.currentTime = 0;
        player.muted = false;
      })
      .catch(() => {
        player.muted = false;
        isPrepared = false;
      });
  }
}

export function playScoreDialClick(): void {
  const pool = getPlayers();
  const player = pool[nextPlayer];
  nextPlayer = (nextPlayer + 1) % pool.length;

  player.pause();
  player.currentTime = 0;
  player.muted = false;
  void player.play().catch(() => {
    // A later touch can prepare the pool again if the browser rejected this
    // playback attempt.
    isPrepared = false;
  });
}
