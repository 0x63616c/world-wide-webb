# Performance Lab Recommendation

Source: pan-lab full sweep (1200 runs, 5 arms × grid × tiles × heavy × optimize),
epic www-5p4. Corrected from the auto-generated finalize note, which picked
transform-cv — the data does not support that.

## Verdict: **transform + windowing** (`transform-window`)

Across all configs (including heavy tiles):

| Arm | Mean FPS | % runs ≥55fps |
|---|---|---|
| **transform-window** | **100** | **85%** |
| native-scroll | 57 | 55% |
| transform-cv | 52 | 45% |
| transform (plain) | 37 | 25% |
| canvas / WebGL | 30 | 22% |

**Windowing is the only arm that scales.** At `heavy=0` every arm holds 55fps to
500 tiles, so raw tile count is not the bottleneck — **heavy-tile ratio is the
knee driver**. Windowing shrugs it off structurally: it never mounts off-screen
tiles, so a 200×200 world full of maps costs the same as a single screenful. That
win is a DOM-node-count property, not a GPU one, so it should hold on the iPad.

## Answers to the contract questions
- **A1 (the knee):** with no windowing, the knee is driven by heavy-tile ratio,
  not tile count — plain transform falls below 55fps once heavy tiles appear
  on-screen, regardless of grid size.
- **A2 (is content-visibility enough, or is windowing required?):** **windowing is
  required.** content-visibility + off-screen-pause (transform-cv: 52fps / 45%)
  does NOT match true windowing (100fps / 85%). content-visibility skips *paint*
  but the tiles stay mounted (layout + JS + live data); windowing removes them
  from the DOM entirely.
- **A3 (do we need canvas?):** inconclusive from this sweep — see caveat.
- **A4 (heavy tiles):** heavy ratio, not count, is what tanks every non-windowing
  arm; cap concurrent on-screen maps/videos regardless of arm.

## Caveats — these are COARSE numbers
- The sweep ran **8 browsers in parallel** → CPU contention depresses all FPS.
- Headless Chromium has **no real GPU** (software WebGL / SwiftShader), which
  **unfairly penalizes the canvas/Pixi arm** (30fps is almost certainly a headless
  artifact; canvas could rank far higher on the iPad's real GPU).
- Trust the **relative structural finding (windowing wins)**, not absolute FPS.
  Confirm feel on the iPad via the launcher (`homelab:4310`).

## Recommendation for control-center
Take **transform + 2D windowing** into the real board: imperative `translate3d`
camera (camera in a ref, never setState per frame), tiles `React.memo`'d, mount
only tiles whose world-rect intersects viewport + overscan. Layer the few heavy
tiles (Tesla map, dog cam) as before and pause them when windowed out. Re-run the
canvas arm on the iPad before ruling it out, since its desktop number is the least
trustworthy here.
