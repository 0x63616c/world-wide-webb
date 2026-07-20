/**
 * The panel's cue library , every sound the app can make, by name.
 *
 * Cues are named for what they MEAN ("shutter"), not for who plays them, so a
 * second caller wanting a camera snap does not end up with a second copy tuned
 * slightly differently.
 *
 * Synths receive the output node to connect to rather than reaching for
 * `audio.destination` themselves; see the bus's header for why.
 */

import { UI_SOUND } from "../ui-sound";

export interface Cue {
  /** iOS UISounds file path, preferred when the plugin is present. Omit for a
   *  cue iOS has no equivalent for. */
  uiSoundPath?: string;
  /** Web Audio construction , the fallback off-panel, and the only path for a
   *  cue with no iOS sound. */
  // biome-ignore lint/style/noRestrictedGlobals: the sound bus owns the context
  synth: (audio: AudioContext, out: AudioNode, now: number) => void;
}

// ─── building blocks ──────────────────────────────────────────────────────────

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

/** One decaying band-passed white-noise burst , the building block of a snap. */
function noiseBurst(
  // biome-ignore lint/style/noRestrictedGlobals: the sound bus owns the context
  audio: AudioContext,
  out: AudioNode,
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

  source.connect(bandpass).connect(g).connect(out);
  source.start(start);
  source.stop(start + duration);
}

// ─── the library ──────────────────────────────────────────────────────────────

export const CUES = {
  /**
   * A camera shutter.
   *
   * On the kiosk this is iOS's own shutter (photoShutter.caf) , a real
   * recording, instantly recognisable, with nothing bundled.
   *
   * The synthesized fallback is deliberately gentler than the two-burst snap it
   * started as, which ran at 0.62/0.42 gain to carry across a room and read as
   * harsh up close , high-gain band-passed noise is closer to a hiss than a
   * click. Darker centre frequencies and roughly a third of the gain keep the
   * mechanical character without the brightness.
   */
  shutter: {
    uiSoundPath: UI_SOUND.photoShutter,
    synth: (audio, out, now) => {
      // Top click , the shutter itself.
      noiseBurst(audio, out, now, { freq: 1400, q: 1.6, gain: 0.22, duration: 0.03 });
      // Body , gives the snap weight without the hiss.
      noiseBurst(audio, out, now, { freq: 480, q: 0.9, gain: 0.17, duration: 0.07 });
    },
  },

  /** A single countdown tick: a short, soft sine blip. Synthesized everywhere ,
   *  iOS's stock tick sounds belong to its own UI and read wrong here. */
  countdownTick: {
    synth: (audio, out, now) => {
      const osc = audio.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 880;
      const gain = audio.createGain();
      // Fast attack then exponential decay , a "tick", not a sustained beep.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain).connect(out);
      osc.start(now);
      osc.stop(now + 0.14);
    },
  },
} as const satisfies Record<string, Cue>;

export type CueName = keyof typeof CUES;
