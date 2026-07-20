/**
 * booth-sounds , the photo booth's capture audio.
 *
 * Still no binary assets. The shutter prefers iOS's OWN recording, played
 * through the SystemSound plugin (lib/system-sound), so the kiosk gets a real
 * camera snap with nothing bundled and no licence to honour; everywhere else
 * falls back to synthesis. The countdown tick stays a synthesized sine blip.
 * So there remains nothing to license, bundle, or fetch.
 *
 * Everything is defensive about the runtime. The kiosk webview has audio, but
 * Storybook/CI/jsdom may lack `AudioContext` or block autoplay until a gesture,
 * so `audioContext()` returns null when unavailable and every play function is a
 * silent no-op in that case rather than throwing into a capture sequence.
 */

import { playSystemSound, SYSTEM_SOUND } from "@/lib/system-sound";

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
 * A camera shutter.
 *
 * On the kiosk this is iOS's own shutter (photoShutter.caf, via the SystemSound
 * plugin) , a real recording, instantly recognisable, with nothing bundled and
 * no licence to honour. The synthesized version below is the fallback for
 * everywhere the plugin does not exist: a browser, Storybook, CI.
 *
 * That fallback is deliberately gentler than the original two-burst snap, which
 * ran at 0.62/0.42 gain to carry across a room and read as harsh up close ,
 * high-gain band-passed noise is closer to a hiss than a click. Darker centre
 * frequencies and roughly a third of the gain keep the mechanical character
 * without the brightness.
 */
export function playShutter(): void {
  if (playSystemSound(SYSTEM_SOUND.photoShutter)) return;

  const audio = audioContext();
  if (!audio) return;
  const now = audio.currentTime;
  // Top click , the shutter itself.
  noiseBurst(audio, now, { freq: 1400, q: 1.6, gain: 0.22, duration: 0.03 });
  // Body , gives the snap weight without the hiss.
  noiseBurst(audio, now, { freq: 480, q: 0.9, gain: 0.17, duration: 0.07 });
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
