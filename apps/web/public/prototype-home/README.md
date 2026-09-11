# Home / Atmosphere — throwaway design prototype

Question: can visually distinct, tactile bento tiles make the everyday home controls feel compelling on a wall iPad and useful on an iPhone?

Three compositions share in-memory simulated controls: Afterglow (`?variant=A`), Daybreak (`?variant=B`), Listening room (`?variant=C`). No design is selected yet. Do not merge this exploration into production. Native implementation is a separate future step; this browser prototype neither uses Capacitor nor proves native runtime stability.

Run from this worktree:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory apps/web/public/prototype-home
```

Open http://localhost:8766. All weather, indoor temperatures, light and speaker state are illustrative. Clock/date use local time. Calendar deliberately awaits a selected source. Nothing calls household APIs. State resets on reload. Master volume preserves saved relative speaker proportions until a speaker reaches 100%; TV-only volume changes only Living room.

## Visual research

- [Mobbin: Ultrahuman dashboard](https://mobbin.com/explore/screens/36e5a755-9c0d-4afb-ba4e-dff42cd39a47): inspected the public screen; stacked mobile grouping and distinct bounded modules.
- [Dribbble: Arya M Nair weather bento](https://dribbble.com/shots/26428370-Weather-App-Bento-Tiles): inspected the public shot; concise module identity and legible visual scales.
- [Awwwards: Messenger by abeto](https://www.awwwards.com/sites/messenger): inspected the award page and artwork; expressive material and an intentionally coherent visual world. Not a dashboard template.

All prototype artwork is authored CSS and SVG, no reference artwork copied. Typography uses DM Sans / Manrope from Google Fonts with system fallbacks. There are no bundled libraries or build step. Light/color controls, climate controls and sound controls intentionally simulate writes.

## Validation

Checked JavaScript syntax and browser interactions for lights, color save/delete, climate modes and setpoint changes, room balancing and variant switching. Checked landscape dimensions and portrait overflow. This is design evidence, not integration or native-device validation.
