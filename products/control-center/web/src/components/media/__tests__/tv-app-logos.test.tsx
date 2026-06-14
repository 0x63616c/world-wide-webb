/**
 * Tests for the TV-app ordering (www-fnh7).
 *
 * tvAppsInOrder is the single source of display order for both the tile grid
 * and the AllAppsModal: curated favorites first (fixed order), then the rest
 * with branded-logo apps before glyph-only fallbacks.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TvAppMark, tvAppsInOrder } from "../tv-app-logos";

afterEach(cleanup);

/** The full live source_list on the prod Apple TV as of www-rii3. */
const PROD_APPS = [
  "AMC+",
  "App Store",
  "Arcade",
  "BBC iPlayer",
  "CNN",
  "Computers",
  "Disney+",
  "FaceTime",
  "Fitness",
  "HBO Max",
  "Hulu",
  "Music",
  "Netflix",
  "Paramount+",
  "Peacock",
  "Photos",
  "Podcasts",
  "Prime Video",
  "Search",
  "Settings",
  "Sling",
  "Spotify",
  "TV",
  "Twitch",
  "VLC",
  "Watch TruBlu",
  "YouTube",
] as const;

describe("TvAppMark brand coverage (www-rii3)", () => {
  // The glyph fallback is the only mark styled with the mono font, so its
  // presence in the markup is the machine-checkable "no logo" signal.
  it.each(PROD_APPS)("renders a real brand mark for %s (no glyph fallback)", (name) => {
    const { container } = render(<TvAppMark name={name} size={30} />);
    expect(container.innerHTML).not.toContain("--mono");
    expect(container.firstChild).not.toBeNull();
  });

  it("still falls back to the 2-letter glyph for unknown apps", () => {
    const { container } = render(<TvAppMark name="Some Future App" size={30} />);
    expect(container.innerHTML).toContain("--mono");
    expect(container.textContent).toBe("SF");
  });
});

describe("tvAppsInOrder", () => {
  it("puts favorites first in the curated order, regardless of source order", () => {
    const out = tvAppsInOrder(["Hulu", "Netflix", "YouTube", "Disney+"]);
    expect(out).toEqual(["YouTube", "Netflix", "Disney+", "Hulu"]);
  });

  it("orders the non-favorite rest as branded-logo apps before glyph-only apps", () => {
    const out = tvAppsInOrder([
      "Plex",
      "Peacock",
      "Netflix",
      "Crunchyroll",
      "YouTube",
      "Paramount+",
    ]);
    expect(out).toEqual([
      // favorites (curated order)
      "YouTube",
      "Netflix",
      // branded non-favorites (source order preserved)
      "Peacock",
      "Paramount+",
      // glyph-only non-favorites (source order preserved)
      "Plex",
      "Crunchyroll",
    ]);
  });

  it("matches favorites by normalized key, so spelling variants still resolve", () => {
    // "HBO Max" → Max favorite; "Apple TV" → Apple TV+ favorite.
    const out = tvAppsInOrder(["HBO Max", "Apple TV", "YouTube"]);
    expect(out).toEqual(["YouTube", "Apple TV", "HBO Max"]);
  });

  it("only includes apps present in source_list (no phantom favorites)", () => {
    // Disney+/Hulu/etc. are favorites but absent from source → must not appear.
    const out = tvAppsInOrder(["Netflix", "Plex"]);
    expect(out).toEqual(["Netflix", "Plex"]);
  });

  it("returns the real source_list strings so they stay launchable", () => {
    const out = tvAppsInOrder(["Prime Video"]);
    expect(out).toEqual(["Prime Video"]);
  });
});
