# Control Center

The domain of the wall-mounted home control panel: a fixed-size touch surface showing a
world of tiles, backed by a tRPC API and interval workers that reconcile the physical
home. This glossary fixes the ubiquitous language. Terms marked _(partly built)_ name a concept
still mid-migration; they are recorded here so design conversations stay precise.

## The device and its surface

**Panel**:
The physical wall-mounted touch device. A single fixed, non-responsive `1366x1024` surface;
there is one per home.
_Avoid_: screen, kiosk, display, tablet.

**Board**:
The single pannable world that fills the Panel and hosts every Tile, plus the always-on
Chrome. Panning is frozen whenever an Overlay is open.
_Avoid_: canvas, grid, desktop, home screen.

**Phone view**:
The separate screen the app renders when it is opened on a phone instead of the Panel: a
scroll column of the two Tiles worth reaching for a phone to use (quick Controls, Climate ·
A/C), plus the Settings gear. It is not a resized Board and shares none of the Board's
Chrome; a phone is detected by narrow viewport or phone user agent (an iPad is always the
Panel, never a phone).
_Avoid_: mobile board, responsive board, small screen.

**Chrome**:
The always-on, board-level surfaces that belong to no single Tile — status banners and update
prompts drawn directly on the Board rather than through a Tile.
_Avoid_: HUD, shell, overlay (an Overlay is a different thing — see below).

**Banner**:
One piece of Chrome: a persistent notice strip on the Board (device-name, connection-lost,
update-available-reload). A Banner is not a Tile and has no detail view. Banners are Panel
chrome: the device-name Banner never appears in the Phone view (a phone's auto-derived device
name is already correct).
_Avoid_: toast, alert, notification.

## Tiles and their detail surfaces

**Tile**:
A rectangular feature card placed on the Board — the atomic unit of the interface. Each Tile
has a stable id, a compact card face, and (usually) a detail surface reached by tapping it.
_Avoid_: widget, card, block, panel (Panel is the device).

**Home tile**:
The one Tile the Board recenters on when it returns to rest (the clock). There is exactly one.
_Avoid_: default tile, start tile.

**Placement**:
Where a Tile sits in the Board's coordinate space — its world column/row and its column/row
span. Placement has a per-Tile default and an optional persisted override; a Tile with neither
a default nor an override slot is unplaced.
_Avoid_: position, layout, coordinates.

**Tile View**:
The concept of a Tile's detail surface — what opens when a Tile is tapped. Today a Tile View is
realised as either a Modal or (for the migrated Tiles) a Page; the term is agnostic to which.
_Avoid_: detail, expanded view, drilldown.

**Overlay**:
Any surface that covers the Board, is anchored to fill it, and freezes Board panning while open
(Modals, Pages, the PIN gate, and full-screen tools all are Overlays). The umbrella term.
_Avoid_: dialog, popup, sheet.

**Modal**:
The legacy form of Tile View: a dialog-style Overlay, one of which may offer several **Variants**
switchable in place (e.g. three ways to read the same Tile's data). The pattern being migrated
away from.
_Avoid_: popup, dialog.

**Variant**:
One of several interchangeable renderings of a single Modal's Tile View, chosen by a switcher.
Peculiar to the Modal form; a Page has no Variants.
_Avoid_: mode, tab, view (Tile View is the whole surface).

**Page** _(partly built)_:
The target form of Tile View: a single full-screen Overlay that replaces the multi-Variant
Modal — one scrolling surface with a back affordance, Escape-to-close, and idle-dismiss. Settings
and Activity already take this form; the rest are to follow.
_Avoid_: full-page modal, screen, route.

## Grouping

**Product**:
A deployable top-level unit of the repo: its own services, image builds, database, and namespace.
There is one Product, control-center; the term is retained for the deploy unit itself, not as a
claim that more than one exists. Described by a **Product Manifest**
(`controlCenterProductManifest()` in `packages/platform`). Must not be confused with App / App
Manifest below.
_Avoid_: app (an App is smaller — see below), service, package.

**App**:
A single self-contained feature grouped as one unit — its Tile(s), the API slice that backs them,
the Worker Cycles it needs, and the tables it owns — living together in one folder inside a
Product: `features/<id>/`. The folder existing is the App's registration (ADR-0001); a generated
aggregate (`features/_generated/*.gen.ts`, ADR-0002) is how the Board, the router, and the worker
process consume every App without a hand-maintained registry.
_Avoid_: feature, module (reserved for design vocabulary), plugin, product.

**App Manifest**:
The single declaration that ties an App's parts together — its Tiles, router slice, tables, and
flags such as Sensitive — an App's `manifest.ts`. Distinct from the deploy-time Product Manifest.
_Avoid_: manifest (ambiguous — always qualify as App or Product), config, registration.

## Security and access

**Sensitive**:
An App-level manifest flag marking a feature whose Tile View may only be opened after Unlock —
reuses the one shared PIN Session for the rest of the panel session.
_Avoid_: private, protected, locked, secure.

**Private**:
An App-level manifest flag marking a feature that requires a fresh PIN entry every time it opens,
never reusing the shared PIN Session (Photo Booth is the one example).
_Avoid_: sensitive (different re-entry rule — see above).

**PIN**:
The numeric passcode (six digits) that guards Sensitive and Private features. Stored as a synced
setting and compared entirely on the client; no server-side check exists (ADR-0004 — accepted
state until a deferred server-side slice).
_Avoid_: password, passcode, code.

**Unlock** / **PIN Session**:
The state of having entered the correct PIN so a Sensitive Tile View will open. One shared session
covers every Sensitive surface for the rest of the panel session; it expires on the idle-reset
that also dims the panel and glides the camera home. Private surfaces bypass the session and
re-prompt every time.
_Avoid_: login, auth, unlocked flag.

## Backend work

**Worker Cycle**:
One iteration of a named interval loop that runs on a fixed cadence and reconciles some slice of
desired state against the physical home or an external service (lights, climate, Sonos volume,
weather ingest/purge). Cycles never overlap with themselves. Declared in an App's `worker.ts`,
composed into `features/_generated/workers.gen.ts`.
_Avoid_: tick, task, job, cron.

**Enforcer**:
A Worker Cycle whose job is to drive a device's reported state toward its desired state on every
iteration (the desired-state-is-truth pattern). A named subtype of Worker Cycle.
_Avoid_: reconciler, syncer.

**Cron**:
A scheduled Kubernetes job that runs on a calendar schedule (currently: database backups) —
distinct from a Worker Cycle (fixed interval, always-on process). Declared in
`infra/src/crons.ts`; there is no app-level scheduler, and app-level recurring work is always a
Worker Cycle, never a CronJob.
_Avoid_: scheduled task, timer, queue job (there is no job queue in this repo).

## Playback

**AV Control**:
Live control of the Sonos sound system (transport, volume, grouping, source). Backed by one
live-queried API slice; no download or storage, and no credentials — grouping and volume are
plain Home Assistant/Sonos calls, and the one Spotify-shaped detail (labelling a group's
now-playing source) is a URI string match, not an API integration.
_Avoid_: media (ambiguous with Photo Booth/Activity's stored images), playback (too broad), sound.

