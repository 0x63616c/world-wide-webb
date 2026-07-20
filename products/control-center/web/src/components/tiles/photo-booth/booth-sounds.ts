/**
 * booth-sounds , the photo booth's capture audio, synthesized live with the Web
 * Audio API. No binary assets: a shutter is a short band-passed noise snap and a
 * countdown tick is a brief sine blip, so there is nothing to license, bundle,
 * or fetch, and the whole thing is a few hundred bytes of code.
 *
 * Everything is defensive about the runtime. The kiosk webview has audio, but
 * Storybook/CI/jsdom may lack `AudioContext` or block autoplay until a gesture,
 * so `audioContext()` returns null when unavailable and every play function is a
 * silent no-op in that case rather than throwing into a capture sequence.
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Browsers suspend a context created before a gesture; a capture press is a
  // gesture, so resuming here lets the first shutter actually sound.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface NoiseBurst {
  /** Band-pass centre frequency in Hz. */
  freq: number;
  /** Band-pass Q (resonance); lower is broader/fuller. */
  q: number;
  /** Peak linear gain (0..1). */
  gain: number;
  /** Burst length in seconds. */
  duration: number;
}

/** One decaying band-passed white-noise burst , the building block of the snap. */
function noiseBurst(
  audio: AudioContext,
  start: number,
  { freq, q, gain, duration }: NoiseBurst,
): void {
  const frameCount = Math.max(1, Math.ceil(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, frameCount, audio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    const t = i / frameCount;
    channel[i] = (Math.random() * 2 - 1) * (1 - t) ** 2;
  }

  const source = audio.createBufferSource();
  source.buffer = buffer;
  const bandpass = audio.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = freq;
  bandpass.Q.value = q;
  const g = audio.createGain();
  g.gain.value = gain;

  source.connect(bandpass).connect(g).connect(audio.destination);
  source.start(start);
  source.stop(start + duration);
}

/**
 * A camera shutter: a loud, punchy mechanical "ka-chack". Two layered noise
 * bursts , a bright high click (the shutter itself) over a shorter, fuller low
 * thump (the mirror slap) , read as a real DSLR snap and, crucially, carry across
 * the room from the wall panel where a single thin click was easy to miss. A
 * short burst of decaying white noise through a band-pass reads as a "click" far
 * better than any tone; the quadratic decay envelope keeps each layer tight.
 */
export function playShutter(): void {
  const audio = audioContext();
  if (!audio) return;
  const now = audio.currentTime;
  // Bright top click , loud and present.
  noiseBurst(audio, now, { freq: 3000, q: 1.0, gain: 0.62, duration: 0.06 });
  // Low body thump , gives the snap weight so it punches, not just ticks.
  noiseBurst(audio, now, { freq: 850, q: 0.7, gain: 0.42, duration: 0.11 });
}

/** A single countdown tick: a short, soft sine blip. */
export function playCountdownTick(): void {
  const audio = audioContext();
  if (!audio) return;
  const now = audio.currentTime;

  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 880;
  const gain = audio.createGain();
  // Fast attack then exponential decay , a "tick", not a sustained beep.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.14);
}
