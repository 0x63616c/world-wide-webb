# Home design testbed

A Storybook-only exploration of a fixed 1366 × 1024 home panel. The current design uses a four-by-four base grid with 14px gutters, a smaller clock on the top row, and wider lighting controls. The screen has no header/footer chrome; the device frame and navigation belong to the preview.

## Pages

Run from `apps/web`: `bun run storybook -- --port 16006 --no-open`.

- iPad layout: `/iframe.html?id=prototypes-bento-home--white&viewMode=story`
- All 21 tile variations: `/iframe.html?id=prototypes-bento-home--tile-studies&viewMode=story`
- Unscaled panel: `/iframe.html?id=prototypes-bento-home--panel-canvas&viewMode=story`
- Individual tile: `/iframe.html?id=prototypes-bento-home--tile-focus&viewMode=story&tile=climate&variant=b`

The gallery shows three compositions for each of the seven tile types. Open any example to try it at its intrinsic panel size. Gallery and device previews scale uniformly to available browser space; the underlying panel remains fixed. Tile IDs and exact dimensions live in `TILE_SIZES`.

## Control boundaries

Bedroom and Living room control lamps. Kitchen lights are independent. Lamps on/off never touches Kitchen. The illustrative bedroom scene includes the strip and two bedside lamps requested by the user; entity-level grouping still needs implementation.

Every mutation is local React state. The production board and devices are unchanged. Initial device/weather values came from read-only production queries on September 6, 2026 at 18:54 UTC. The clock runs in America/Los_Angeles. Auto's initial 70–75°F range is an exploratory selection, not an observed setting. Weather is a dated snapshot. Desk volume controls the displayed coordinator volume; it is not presented as a synchronized volume for every speaker.

## Visual direction

Keep the clock face and soft 3D cloud illustration; use room vignettes and a small physical fan object. Keep text sparse and controls distinct. The climate studies compare a side mode list, central dial, and number-first layout. Changes stay on the draft design branch while Calum chooses a direction.

References: the two user-supplied white widget screenshots and [Apple's widget design guidance](https://developer.apple.com/design/human-interface-guidelines/widgets).

## Verification

Web TypeScript and Biome checks pass. Browser verification exercises all interactive variants: independent lamp/kitchen switching, AC setpoint and all modes, Auto range selection, Sonos source/volume, and fan switches. It also checks unique DOM IDs, zero device API calls, no overlapping panel rectangles, no clipped cards, and narrower preview widths.

Local visual receipts and the runnable Playwright verification script live in `output/bento-home/` in this worktree. `ipad-final.png`, `panel-final.png`, and `testbed-final.png` capture the current pages. Run `node output/bento-home/verify.mjs` from the worktree after starting Storybook.
