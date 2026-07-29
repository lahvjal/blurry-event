type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  if (typeof window === 'undefined') return null;

  const AudioContextConstructor =
    window.AudioContext ??
    (window as WebkitAudioWindow).webkitAudioContext;
  if (!AudioContextConstructor) return null;

  audioContext = new AudioContextConstructor();
  return audioContext;
}

/**
 * Browsers will not start audio until it is unlocked by a user gesture. The
 * dial calls this as soon as the finger lands so the first detent can click.
 */
export function prepareScoreDialAudio(): void {
  const context = getAudioContext();
  if (context?.state === 'suspended') {
    void context.resume().catch(() => {});
  }
}

function emitClick(context: AudioContext): void {
  const now = context.currentTime;
  const duration = 0.018;
  const frameCount = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);

  // A tiny, quickly decaying burst of noise reads as a physical dial detent
  // without needing to download or decode an audio asset.
  for (let i = 0; i < frameCount; i += 1) {
    const decay = 1 - i / frameCount;
    samples[i] = (Math.random() * 2 - 1) * decay;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1400, now);
  filter.Q.setValueAtTime(0.8, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(now);
  source.stop(now + duration);
}

export function playScoreDialClick(): void {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === 'suspended') {
    void context
      .resume()
      .then(() => emitClick(context))
      .catch(() => {});
    return;
  }

  emitClick(context);
}
