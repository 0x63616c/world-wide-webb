# Air Miles

A private native flight journal inspired by Flighty's map and flight cards, designed for iPhone Duo. Overview shows the route network and lifetime totals; Flights supports city, airport, country and airline search, year filters, uncertainty filtering, and split-view details; Passport explores annual flights, frequent airports and countries.

All flight data, geography and airport lookups stay offline. Uncertain records are retained and labelled. Unknown flight numbers are not invented. Distances come from the CSV; route lines illustrate great-circle paths, not actual flight tracks. Airport-based country totals include connections. No flight durations or live statuses are inferred.

Appearance follows the system. Dark mode uses true #000000 backgrounds, cards, and map oceans, with graphite land and thin separators. `--dark` and `--light` provide deterministic appearance for fixture screenshots.

## Run

Requires Xcode 26.2+; Xcode 27.1+ enables real hinge observation. Generate from this folder with `xcodegen generate`, then build `AirMiles.xcodeproj`, scheme `AirMiles`, for an iPhone simulator with `CODE_SIGNING_ALLOWED=NO`. The app supports compact, expanded split-view, and partially folded tabletop layouts. The current sidebar selection and filters stay in memory while resizing.

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
- `App/Resources/land.json`: exterior polygons, rounded to three decimal degrees, from [Natural Earth 1:110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson). Public domain.
- Visual reference: [Flighty on Duo-ready](https://duo-ready.com/apps/flighty). No Flighty artwork or branding is used.
