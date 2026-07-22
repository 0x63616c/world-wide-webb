# Implementation Plan: Export Logs from the Logs Modal

## Goal

Add an **Export logs** affordance to the control-center web Logs modal that shares
the already-on-disk native log mirror JSONL files (`cc-logs/current.jsonl` and,
when present, `cc-logs/previous.jsonl`) via the iOS share sheet.

## Locked design (do NOT redesign)

Export = share the files that the native mirror writer (`src/lib/log/native.ts`)
has **already written to disk**, using `@capacitor/share`. We do **not** serialize
IndexedDB or the in-memory ring at share time. This is deliberate, for
failure-resilience:

- No new code runs at "rescue time" beyond resolving file URIs and invoking the OS
  share sheet — the risky path (reading a million entries out of IndexedDB) never
  runs.
- Zero memory spike: the OS reads the files; we hand it URIs, not bytes.
- The files are the on-disk truth the mirror exists to preserve; sharing them is
  the most honest export we can offer.

The button is gated to the native Capacitor platform. Off-native it is rendered
**disabled** (greyed, with an explanatory tooltip) rather than fully hidden — see
[Off-native behaviour](#off-native-behaviour) for the rationale and the one-line
change if we later prefer hiding it.

## Verified facts (re-confirmed against the source)

- **Mirror location constants** (`src/lib/log/native.ts`): `DIR = "cc-logs"`,
  `CURRENT = "cc-logs/current.jsonl"`, `PREVIOUS = "cc-logs/previous.jsonl"`,
  directory is `Directory.Data` (the module passes the string `"DATA"` as
  `directory`). The share MUST resolve URIs for these exact path+directory pairs.
- `native.ts` defines a **local `LogFilesystem` interface** (only the ops it uses)
  and loads the real plugin via dynamic `import("@capacitor/filesystem")`, guarded
  by `Capacitor.isNativePlatform()` and `Capacitor.isPluginAvailable("Filesystem")`.
  It does **not** currently expose file URIs, and `getUri` is **not** in the
  interface — both need adding.
- Test seams already exist: `setFilesystemForTests(fs | null)` and
  `resetNativeForTests()`. Existing tests (`src/lib/__tests__/log-native.test.ts`)
  inject an in-memory fake `LogFilesystem`. New helper tests follow the same shape.
- `Capacitor.isNativePlatform()` is the platform gate used in `src/lib/brightness.ts`
  and `native.ts`.
- **No generic Button primitive** exists in `src/components/ui/` (there are Chip,
  Pill, ControlTap, Segmented, Switch, Modal, etc., but the modal's toolbar buttons
  are a **local `ToolbarButton`** component inside `LogsModal.tsx`). Reuse that
  local `ToolbarButton` — it already matches the toolbar's `CONTROL_H` height and
  styling. Do not introduce a new UI primitive for this.
- Structured logging: `log.child("source")` from `src/lib/log/logger.ts`. Use
  source tag `logs-export`.
- `@capacitor/share` is **not** installed. Current Capacitor plugins are all `^8.x`
  (core `^8.3.1`), so add `@capacitor/share@^8` to match.
- The "Read-only by design: no copy, no clear" comment lives at
  `LogsModal.tsx` lines ~20–22 and must be updated.

## Design

### 1. Dependency: `@capacitor/share`

- Add to `products/control-center/web/package.json` dependencies via
  `bun add @capacitor/share@^8` (run inside `products/control-center/web`), so the
  version is resolved against the existing Capacitor 8 line. Commit the updated
  `bun.lock`.
- **iOS native sync**: `@capacitor/share` ships an iOS pod. After adding it, the
  Capacitor iOS project must pick it up: `bunx cap sync ios` (which runs
  `pod install`) inside the web product. Note in the PR/commit that the generated
  iOS project / Podfile.lock changes are part of the change. The TestFlight/CI iOS
  build must run `cap sync` before `xcodebuild`; confirm the existing iOS build
  pipeline already does a sync/pod-install step (it does for the other Capacitor
  plugins) — no new CI wiring is expected, but call it out for the reviewer.
- No `Info.plist` usage-description key is required for the share sheet itself
  (it presents system UI and shares files from the app's own container).

### 2. URI-resolution helper (in `native.ts`)

Add to `native.ts` (keeping all `@capacitor/*` access isolated to this module, per
its own header contract):

- Extend the local `LogFilesystem` interface with:
  `getUri(opts: { path: string; directory: string }): Promise<{ uri: string }>`.
- Export a new function, e.g.:

  `export async function getMirrorFileUris(): Promise<string[]>`

  Behaviour:
  - Resolve the filesystem handle via the existing `getFs()` (returns `null` when
    off-native / plugin missing / init failed).
  - If `fs` is `null`, return `[]` (clean, no throw) — callers treat empty as
    "nothing to export".
  - For each generation in oldest→newest order (`PREVIOUS`, then `CURRENT`):
    - `stat({ path, directory: DATA })` to confirm the file exists (a missing file
      throws, matching `readGeneration`'s existing pattern). Skip on throw.
    - For existing files, `getUri({ path, directory: DATA })` and collect `uri`.
  - Return the collected URIs. This naturally handles the
    **`previous.jsonl`-doesn't-exist-yet** case (only `current` is returned) and
    the **nothing-written-yet** case (returns `[]`).
  - Wrap the body so a resolution error yields `[]` rather than propagating —
    export is best-effort, consistent with the rest of the module.

  Ordering rationale: `previous` first, `current` second, so the share sheet lists
  them oldest-to-newest, matching the mirror's own restore order.

### 3. Wire the Export button into `LogsModal.tsx`

- Compute `const canExport = Capacitor.isNativePlatform();` (import `Capacitor`
  from `@capacitor/core`, as `brightness.ts` does — this is a static import, fine
  because `Capacitor.isNativePlatform()` is a pure runtime check that is safe in a
  browser; the heavy plugin stays dynamically imported inside `native.ts`).
- Add an `Export` `ToolbarButton` to the existing toolbar row (the same
  `alignItems: stretch`, `CONTROL_H` row that holds `Load older`). Place it next to
  `Load older`.
- On click, call an async `handleExport` that:
  1. `const uris = await getMirrorFileUris();`
  2. If `uris.length === 0`: log
     `log.child("logs-export").warn("no mirror files to export")` and do nothing
     user-visible beyond leaving the button state normal (optionally a transient
     "Nothing to export yet" label — keep minimal; a warn log is the honest
     record). Do NOT invent an error dialog.
  3. Otherwise dynamically `import("@capacitor/share")` (keeps the plugin out of
     browser bundles, mirroring `native.ts`'s pattern) and call:

     ```
     Share.share({
       title: "Control Center logs",
       text: "Control Center native log mirror",
       files: uris,
       dialogTitle: "Export logs",
     });
     ```
  4. Log success at info: `log.child("logs-export").info("shared", { files: uris.length })`.
- Use a local `exporting` boolean state to disable the button while the share sheet
  is resolving (prevents double-tap), matching the `loadingOlder` pattern.

### 4. Error handling

Use `const exportLog = log.child("logs-export");` and structured payloads:

- **User cancelled the share sheet**: `@capacitor/share` rejects with a
  cancellation. This is **not an error** — detect it (message/`code` contains
  "cancel"/"canceled") and either swallow silently or log at `debug`
  (`"share cancelled"`). Never log it as error and never surface a failure UI.
- **Plugin missing / not available** (e.g. someone runs on native but the pod
  wasn't synced): the dynamic import or `Share.share` throws — catch, log at
  `error` (`exportLog.error("share failed", { message })`), leave the UI usable.
- **No files yet**: handled in step 3.2 above (warn, no-op) — the mirror simply
  hasn't flushed a batch yet.
- Wrap the whole `handleExport` body in try/catch so a share failure can never
  throw into a React event handler.

### 5. Update the "read-only by design" comment

Revise the header comment in `LogsModal.tsx` (lines ~20–22). It currently says:

> Read-only by design: no copy, no clear. The logs are for reading here, on the
> device, which is where the failure is.

Update it to reflect the one new affordance while preserving the intent, e.g.:

> Read-only, with one escape hatch: no copy, no clear, but on the native device
> you can **Export** — this shares the on-disk native log mirror files
> (`cc-logs/*.jsonl`) via the iOS share sheet. Nothing is serialized at share time;
> we hand the OS the files the mirror already wrote, so export cannot spike memory
> or fail on a large store. Off-device the button is disabled.

### 6. Storybook

The modal is rendered in Storybook/web where `Capacitor.isNativePlatform()` is
`false`, so with the [off-native = disabled](#off-native-behaviour) decision the
Export button appears **greyed/disabled** in the existing stories automatically —
no story change is strictly required, but:

- Add a short note to `LogsModal.stories.tsx` documenting that Export is native-only
  and renders disabled in Storybook.
- Optionally add a `ExportEnabled` story that stubs the native gate so the enabled
  button is visible for visual review. Because the gate is `Capacitor.isNativePlatform()`
  (not easily overridable inline), the clean way to make this storyable is to have
  `LogsModal` read `canExport` from a small optional prop with a native default —
  e.g. `nativeExport?: boolean` defaulting to `Capacitor.isNativePlatform()`. The
  story then passes `nativeExport` to force the enabled visual. Keep this prop
  internal/optional; production callers pass nothing. (If we prefer zero new props,
  skip this story and rely on the disabled default appearance.)

Recommended: add the optional `nativeExport` prop — it makes the enabled state
Storybook-representable (repo is Storybook-first for new UI) and makes the button's
enabled path unit-testable without mocking Capacitor globally.

### Off-native behaviour

Chosen: **render disabled, not hidden.** A disabled, tooltip-annotated button
("Export available on the device only") is discoverable, keeps the toolbar layout
stable between web and device, and is representable in Storybook — which the repo
requires for new UI. The button is enabled only when the native gate is true.

If we later prefer hiding it entirely, that is a one-line change (conditionally
render the button on `canExport` instead of passing `disabled={!canExport}`); the
rest of the plan is unaffected.

### 7. Tests

Unit-test the **URI resolution helper** in `src/lib/__tests__/log-native.test.ts`
(reuse the existing in-memory `makeFakeFs` + `setFilesystemForTests` harness):

- Extend the fake `LogFilesystem` with a `getUri` that returns a deterministic
  `file:///fake/<path>` URI.
- `getMirrorFileUris()` returns `[]` when the filesystem is null
  (`setFilesystemForTests(null)`) — off-device/browser.
- With only `current.jsonl` written (via `nativeAppend`), returns exactly the
  `current` URI (previous filtered out because it doesn't exist).
- With both generations present (drive a rotation, or pre-seed the fake's `files`
  map with both paths), returns both URIs in `[previous, current]` order.
- With nothing written, returns `[]`.

The `Share.share` call itself is thin glue over the plugin and is exercised through
the disabled/enabled button state; do not add an integration test that mocks the
share plugin globally. If the optional `nativeExport` prop is added, a light
component test can assert the button is disabled when `nativeExport` is false and
enabled when true.

Gates that must stay green:
- `bun run typecheck` — the new `getUri` interface member and helper are fully
  typed; no `any`.
- `bun run lint`.
- `bun run knip` — the new exported `getMirrorFileUris` is consumed by `LogsModal`,
  so it is not dead; `@capacitor/share` is imported, so it is not an unused dep.
- `bun run test` — new helper tests pass.

## Files to create / modify

**Modify:**
- `products/control-center/web/package.json` — add `@capacitor/share@^8` dependency.
- `products/control-center/web/bun.lock` — regenerated by `bun add`.
- `products/control-center/web/src/lib/log/native.ts` — add `getUri` to the
  `LogFilesystem` interface; add and export `getMirrorFileUris()`.
- `products/control-center/web/src/components/LogsModal.tsx` — import `Capacitor`;
  add `Export` `ToolbarButton` + `handleExport` + `exporting` state; optional
  `nativeExport` prop; update the "read-only by design" header comment.
- `products/control-center/web/src/lib/__tests__/log-native.test.ts` — add `getUri`
  to the fake fs; add `getMirrorFileUris` tests.
- `products/control-center/web/src/components/LogsModal.stories.tsx` — note native-only
  Export; optional `ExportEnabled` story if the `nativeExport` prop is added.
- iOS Capacitor project files regenerated by `bunx cap sync ios` (Podfile.lock and
  generated project metadata) — part of the change, not hand-edited.

**Create:**
- None. (The helper lives in the existing `native.ts` to keep all `@capacitor/*`
  access in one seam, per that file's stated contract. This doc is the only new
  file.)

## Out of scope / non-goals

- No serialization of IndexedDB or the in-memory ring at export time.
- No "copy to clipboard", no "clear logs", no filtered/partial export — the export
  is the raw on-disk mirror, whole files.
- No new shared UI primitive; reuse the local `ToolbarButton`.
- No Android handling (the shell is iOS-only).
