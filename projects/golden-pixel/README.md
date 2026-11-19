# Golden Pixel

A desktop browser incremental pixel-breaker. Balls bounce around a pixel map and break
coloured pixels for money. Each level hides one golden pixel; breaking it clears the level.

Live: https://golden-pixel-ten.vercel.app

## Play

- You start with one Basic ball. Pixel colour is durability: green, lime, amber, red, plum
  take 1 to 5 hits (scaled up each level) and pay more as they get tougher. White walls never break.
- Buy balls from the left bar (keys 1 to 7, Shift buys 10). Every type has its own base price
  and growth, and each purchase raises that type's next price.
- Right-click a ball (or its `+`) for its speed, damage and special upgrades. Ten upgrades on
  one type unlock a choice of two specializations.
- Skill points come from clearing levels. Spend them in the skill tree (T) on damage, speed,
  money, crits, combo time, click damage, a golden pixel radar, offline earnings, starting cash
  and ball unlocks.
- Prestige (✦) from level 3 resets the run for permanent stars (+10% money, +5% damage each).
- Seven hand-made levels grow from 56×34 to 190×116 cells. Clearing The Core wins the game;
  seeded endless levels follow.

| Ball      | Special       | Specializations                                                    |
| --------- | ------------- | ------------------------------------------------------------------ |
| Basic     | Crit chance   | Swarm (cheaper) · Veteran (3× damage)                              |
| Fast      | Twin hit      | Blur (+60% speed) · Flurry (more multi-hits)                       |
| Heavy     | Pierce        | Juggernaut (unlimited pierce) · Wrecking Ball (3× damage)          |
| Lightning | Chain count   | Storm (+4 chains, longer range) · Overcharge (2.5× chain damage)   |
| Bomb      | Blast radius  | Cluster (mini blasts) · Nuke (1.6× radius)                         |
| Sniper    | Lock-on range | Gold Seeker (hunts the golden pixel) · Marksman (2× damage, crits) |
| Ghost     | Phase time    | Poltergeist (phases twice as often) · Wraith (3× phase damage)     |

Progress saves to `localStorage` every 5 seconds and when the tab hides. Settings cover sound,
music, effect intensity, the CRT overlay and resetting the save. Effects scale down
automatically when frame time rises.

## Develop

```sh
cd projects/golden-pixel
bun install
bun run dev      # local server
bun run test     # economy, grid, level and simulation tests
bun run build    # type-check and static build into dist/
```

`src/palette.ts` owns every colour (the Vercel Neon palette); `src/config.ts` owns ball, skill
and tier numbers; `src/economy.ts` holds the pure price and modifier rules.

## Publish

The site is a static Vercel project named `golden-pixel` on Calum's Vercel account. From a
verified main checkout with the Vercel CLI signed in:

```sh
bun run build
npx vercel deploy dist --prod --yes
```

Check that the production URL returns 200 and the title screen loads.
