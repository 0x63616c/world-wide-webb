/**
 * The sound bus's backend-selection contract. Nothing here can hear a cue; what
 * matters is which backend a cue reaches for, and that a runtime with no audio
 * at all stays silent instead of throwing into whatever the cue accompanied.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playCue, resetSoundForTests } from "../sound";

const playSystemSound = vi.fn((_id: number) => true);

vi.mock("../system-sound", () => ({
  SYSTEM_SOUND: { photoShutter: 1108 },
  playSystemSound: (id: number) => playSystemSound(id),
}));

/** A stand-in for the Web Audio nodes a synth builds, recording connections. */
function fakeAudioContext() {
  const node = () => ({
    connect: vi.fn(function (this: unknown, next: unknown) {
      return next;
    }),
    start: vi.fn(),
    stop: vi.fn(),
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    frequency: { value: 0 },
    Q: { value: 0 },
    type: "",
    buffer: null as unknown,
  });
  return {
    state: "running",
    currentTime: 0,
    sampleRate: 44_100,
    destination: { id: "destination" },
    resume: vi.fn(),
    createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(64) })),
    createBufferSource: vi.fn(node),
    createBiquadFilter: vi.fn(node),
    createGain: vi.fn(node),
    createOscillator: vi.fn(node),
  };
}

let ctx: ReturnType<typeof fakeAudioContext>;

beforeEach(() => {
  vi.clearAllMocks();
  playSystemSound.mockReturnValue(true);
  resetSoundForTests();
  ctx = fakeAudioContext();
  vi.stubGlobal(
    "AudioContext",
    vi.fn(() => ctx),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSoundForTests();
});

describe("playCue , cues with a system sound", () => {
  it("uses iOS's own recording when the plugin took it", () => {
    playCue("shutter");
    expect(playSystemSound).toHaveBeenCalledWith(1108);
    // Nothing synthesized: the real recording already played.
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
  });

  it("synthesizes when the plugin is absent", () => {
    playSystemSound.mockReturnValue(false);
    playCue("shutter");
    // Two layered noise bursts make the snap.
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(2);
  });
});

describe("playCue , cues without a system sound", () => {
  it("never asks the plugin, and synthesizes directly", () => {
    playCue("countdownTick");
    expect(playSystemSound).not.toHaveBeenCalled();
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
  });
});

describe("playCue , hostile runtimes", () => {
  it("is a silent no-op where AudioContext does not exist", () => {
    playSystemSound.mockReturnValue(false);
    vi.stubGlobal("AudioContext", undefined);
    expect(() => playCue("countdownTick")).not.toThrow();
  });

  it("is a silent no-op when the context cannot be constructed", () => {
    playSystemSound.mockReturnValue(false);
    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => {
        throw new Error("no audio device");
      }),
    );
    expect(() => playCue("countdownTick")).not.toThrow();
  });

  it("resumes a context suspended before the first gesture", () => {
    playSystemSound.mockReturnValue(false);
    ctx.state = "suspended";
    playCue("countdownTick");
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("reuses one context across cues rather than making a second", () => {
    playSystemSound.mockReturnValue(false);
    playCue("countdownTick");
    playCue("countdownTick");
    expect(vi.mocked(globalThis.AudioContext)).toHaveBeenCalledTimes(1);
  });
});
