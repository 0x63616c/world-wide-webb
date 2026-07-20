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

/**
 * A camera shutter: a fast, bright mechanical snap. A short burst of decaying
 * white noise pushed through a band-pass reads as a "click" far better than any
 * tone, and the quadratic decay envelope keeps it tight rather than a hiss.
 */
export function playShutter(): void {
  const audio = audioContext();
  if (!audio) return;
  const now = audio.currentTime;
  const duration = 0.09;

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
  bandpass.frequency.value = 2600;
  bandpass.Q.value = 0.9;
  const gain = audio.createGain();
  gain.gain.value = 0.3;

  source.connect(bandpass).connect(gain).connect(audio.destination);
  source.start(now);
  source.stop(now + duration);
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
