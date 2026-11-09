# Air Miles

A private native flight journal inspired by Flighty's map and flight cards, designed for iPhone Duo. Overview shows the route network and lifetime totals; Flights supports city, airport, country and airline search, year filters, uncertainty filtering, and split-view details; Passport explores annual flights, frequent airports and countries.

All flight data, geography and airport lookups stay offline. Uncertain records are retained and labelled. Unknown flight numbers are not invented. Distances come from the CSV; route lines illustrate great-circle paths, not actual flight tracks. Airport-based country totals include connections. No flight durations or live statuses are inferred. Optional enrichment keeps reported operations, original booking details and tracking observations separate without rewriting imported identities.

Appearance follows the system. Dark mode uses true #000000 backgrounds and cards, with thin separators and a quiet, stationary field of stars behind the globe. Airline marks retain their original colors, and the globe uses natural blue oceans and land-cover colors in both appearances. `--dark` and `--light` provide deterministic appearance for fixture screenshots.

The offline 3D globe turns once every three minutes at its default zoom, with 110 quiet stars in its background. Drag to explore, pinch for up to 3× magnification, or use the pause control. Zoom changes the camera without moving surrounding content. Default framing fits the whole sphere and its raised routes to either pane aspect ratio; deliberate close-ups can extend beyond the viewport. Gestures pause rotation; double-tap or the reset control restores the view. Overview and Flights share one live globe, which moves between layouts and eases toward a selected route. Returning restores the browsing orientation and zoom. Automatic motion stops with Reduce Motion, when the view disappears, or when the app becomes inactive. Flight details keep their route centered and stationary. `--screenshots` freezes motion for reproducible captures. Typography uses Apple's default system San Francisco, with no rounded or custom font.

## Run

Requires Xcode 26.2+; Xcode 27.1+ enables native Duo arrangements. Generate from this folder with `xcodegen generate`, then build `AirMiles.xcodeproj`, scheme `AirMiles`, for an iPhone simulator with `CODE_SIGNING_ALLOWED=NO`. The app supports compact, expanded split-view, and partially folded tabletop layouts. On iOS 27.1+, Overview uses the native `ArrangementView` split style, adapting each pane to `splitArrangementAxis` with separate scrolling inside the arrangement. Native `TabView`, `NavigationSplitView`, toolbars, search, sheets and menus handle navigation and the changing bar axis. The current sidebar selection and filters stay in memory while resizing. The shared globe follows measured content viewports instead of fixed toolbar dimensions. Earlier OS versions use a compact scrolling overview.

```sh
swift test --package-path apps/airmiles
swift test --package-path packages/RDesign
xcodebuild -project apps/airmiles/AirMiles.xcodeproj -scheme AirMiles \
  -destination 'platform=iOS Simulator,name=iPhone Duo' \
  -derivedDataPath build/airmiles CODE_SIGNING_ALLOWED=NO build
```

## Local history

The app initially shows a clearly labelled synthetic sample journal. Use the import button on Overview to choose an air-miles `segments.csv`. Required columns: `date,airline,flight,from,to,miles,confidence`; confidence is `H`, `M` or `L`. Imports are validated in full before atomically replacing the journal. Mailbox identifiers are discarded. The original airline wording and unknown flight markers are preserved.

For local simulator setup after installing the app:

```sh
python3 apps/airmiles/scripts/import-simulator.py /private/path/segments.csv DEVICE_UDID
xcrun simctl launch DEVICE_UDID com.calumwebb.airmiles
```

Terminate the app before importing with the script. A previous simulator CSV is backed up beside the import. Personal CSVs must stay outside tracked source (the root `build/` folder is ignored). Launch with `--demo` to ignore local data for UI tests and screenshots. `ScreenshotTests` captures Overview, search, flight details and Passport using only synthetic records. No App Store or TestFlight publication is configured.

## Public map data

- `App/Resources/airports.json`: IATA-coded non-closed airports from [OurAirports](https://ourairports.com/data/), retrieved 2026-11-04. Public domain; no guarantee of accuracy.
- `App/Resources/earth.jpg`: reduced 2048×1024 texture from [Natural Earth I, shaded relief and water](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-1/), version 3.2.0. Public domain, bundled offline.
- `App/Resources/land.json`: exterior polygons, rounded to three decimal degrees, from [Natural Earth 1:110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson). Public domain.
- Visual reference: [Flighty on Duo-ready](https://duo-ready.com/apps/flighty). No Flighty artwork or branding is used.
- Airline marks: [Kiwi.com airline directory](https://www.kiwi.com/en/travel/all-airlines/), downloaded from `https://images.kiwi.com/airlines/64/{IATA}.png` on 2026-11-04 and displayed in their original colors. These are airline trademarks, not public-domain map data. They are matched to exact recorded airline names; ambiguous carriers use a neutral symbol. Fixture journeys are synthetic even where they use a real airline's mark.

## BTS enrichment

The local helper downloads public [BTS monthly marketing-carrier archives](https://transtats.bts.gov/PREZIP/) and matches on date, exact known marketing carrier, flight number, origin and destination. It supports domestic US legs from 2018 onward and discovers available months from BTS. It never uploads the journal. Unknown flight numbers, conflicting carrier names, duplicate reports, international flights and unpublished months remain unmatched. Marketing-carrier data includes the operating carrier and tail for regional codeshares.

```sh
python3 apps/airmiles/scripts/enrich-bts.py /private/path/segments.csv \
  --output build/air-miles/import/flight-enrichment.json --cache build/air-miles/bts
python3 apps/airmiles/scripts/test-enrich-bts.py
python3 apps/airmiles/scripts/import-simulator.py /private/path/segments.csv DEVICE_UDID \
  --enrichment build/air-miles/import/flight-enrichment.json
```

Terminate the app before installing data. The helper writes a private match report beside the sidecar; keep both under ignored `build/`. Cached monthly ZIPs allow repeatable reruns. The app loads `Documents/flight-enrichment.json`, whose stable identity keys survive sorting and reimporting. Importing a different journal can only attach records with the same full identity. A malformed sidecar does not prevent the journal loading.

Flight detail shows actual departure/arrival, scheduled times and signed arrival difference. A disclosure reveals tail number, operating flight, airborne duration and source. BTS clocks are local airport times; `24:00` denotes midnight at the end of the reported day. We do not infer UTC instants or calendar-day offsets from these clocks. Cancelled/diverted reports never imply arrival at the booked destination. Missing fields are omitted. Original confidence remains unchanged: an operational match establishes a reported flight, not proof that its passenger boarded. Demo operational records are synthetic and labelled Sample.

## Evidence and optional tracking

`audit-bts.py` finds route/date candidates for manual review. It never changes flight identities or promotes even a unique candidate to a match. Correct the source CSV only from independent evidence, retain the original extraction and a correction log, then rerun exact BTS matching.

The sidecar optionally accepts `bookings`, `observations` and `reviewNotes`, keyed by the same date/carrier/number/airport identity. Booking and tracking panels are collapsed initially. Booking times, seat, cabin and scheduled aircraft are labelled as original confirmation details, not actual operations. Review notes also participate in the uncertainty filter even if the original flight identity has high confidence. Synthetic fixture panels exercise these fields without personal data.

`enrich-opensky.py` evaluates the [OpenSky 2019–2022 research archive](https://zenodo.org/records/7923702). It verifies downloaded archive checksums, matches known flight identities and both airports on the departure airport's local day, and rejects ambiguous matches or unproven alphanumeric callsigns. Inferred airport mismatches remain unmatched. First/last-seen timestamps are tracking observations, never gate times or delay evidence. Keep these evaluation results and cached archives local under ignored `build/`, subject to the dataset license; they are not bundled or redistributed with the app.

```sh
python3 apps/airmiles/scripts/enrich-opensky.py --help
python3 apps/airmiles/scripts/test-enrich-opensky.py
```

BTS output additionally preserves wheels-off/on, taxi minutes and reported delay causes. Running `enrich-bts.py` creates a fresh BTS-only sidecar; combine independently reviewed optional records afterwards, checking their full identity keys against the imported journal. Do not merge data merely on route or flight number alone.

Duo implementation references: [Apple's adaptive arrangements](https://developer.apple.com/videos/play/tech-talks/111463/) and [native bars on Duo](https://developer.apple.com/videos/play/tech-talks/111462/). Test inner landscape/portrait, book/tabletop, outer display, Reduce Motion, search dismissal and selection continuity after resizing. Screenshot fixtures freeze rotation; record motion previews with `--demo --dark` without `--screenshots`.
