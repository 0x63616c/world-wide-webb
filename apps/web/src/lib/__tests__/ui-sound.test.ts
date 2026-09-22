import { describe, expect, it } from "vitest";
import { playUISound, UI_SOUND } from "../ui-sound";

describe("playUISound", () => {
  it("reports false so the sound bus uses its synthesized fallback", () => {
    expect(playUISound(UI_SOUND.photoShutter)).toBe(false);
  });
});
