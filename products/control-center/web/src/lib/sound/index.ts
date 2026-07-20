/**
 * The panel's sound bus , the single owner of audio output in the app.
 *
 * Anything that wants to make a noise calls `playCue(name)`. Nothing else
 * constructs an AudioContext or reaches for the SystemSound plugin directly;
 * a Biome rule enforces that, because the alternative is what this replaced ,
 * audio owned by whichever feature happened to need it first, with its own
 * context, its own gain literals, and no shared place to change anything.
 *
 * A cue can have two backends and usually wants both:
 *
 *  - `systemSoundId` plays one of iOS's own recordings (AudioToolbox, via
 *    lib/system-sound). Real audio, nothing bundled, no licence to honour ,
 *    but only on the kiosk.
 *  - `synth` builds the sound with the Web Audio API. It is the fallback for a
 *    browser, Storybook and CI, and the only path for cues iOS has no sound for.
 *
 * How LOUD any of it is is not this module's business. Volume is a property of
 * the device (see lib/panel-volume and the Settings slider), not an in-app gain
 * , an app-level multiplier on top of the system volume would mean two numbers
 * that both have to be right for the panel to be audible. Synths are handed an
 * output node rather than reaching for `destination` themselves, so if that ever
 * needs to change it changes in one place.
 *
 * Everything is defensive about the runtime. Storybook/CI/jsdom may lack
 * `AudioContext` or block autoplay until a gesture, so a cue that cannot be
 * played is a silent no-op and never throws into whatever it was accompanying.
 */

import { playSystemSound } from "../system-sound";
import { CUES, type Cue, type CueName } from "./cues";

export type { CueName } from "./cues";

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

/** The shared context, created on first use. Null where audio is unavailable. */
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
  // Browsers suspend a context created before a gesture; most cues are played in
  // response to one, so resuming here lets the first of them actually sound.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * Play a named cue. Prefers iOS's own recording where the cue has one and the
 * plugin is present, otherwise synthesizes.
 *
 * Returns nothing on purpose: a caller cannot do anything useful about a cue
 * that did not play, and every call site is decorating an action that must
 * carry on regardless.
 */
export function playCue(name: CueName): void {
  // Widened to Cue: the literal registry narrows each entry to its own shape, so
  // a cue without a system sound would not admit the optional field at all.
  const cue: Cue = CUES[name];
  if (cue.systemSoundId !== undefined && playSystemSound(cue.systemSoundId)) return;

  const audio = audioContext();
  if (!audio) return;
  cue.synth(audio, audio.destination, audio.currentTime);
}

/** Test seam: drop the shared context so a case can start from nothing. */
export function resetSoundForTests(): void {
  ctx = null;
}
