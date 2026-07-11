# Sonos Groups Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Groups modal (patch-bay UX) so the wall panel can move Sonos speakers between live sources ("play desk everywhere", "TV in living room + desk elsewhere").

**Architecture:** Backend first — fix the DIDL decode bug, add `getMediaInfo()`, extend the sound-system service with per-group source classification. Frontend second — pure `deriveSources` function, membership hook with stale-poll gating, presentational `GroupsModalView` (Storybook-first), then the container wired into `SoundSystemTile`.

**Tech Stack:** Bun, tRPC, zod, vitest, React 18, Storybook. Spec: `docs/superpowers/specs/2026-07-11-sonos-groups-modal-design.md`.

## Global Constraints

- Fixed wall panel `1366x1024`, not responsive.
- Shared UI primitives from `products/control-center/web/src/components/ui/` (Modal).
- No fake or placeholder data — absent track metadata renders as input-kind label only.
- Storybook-first for new UI; presentational/container split like SoundSystemTileView/SoundSystemTile.
- Backend code uses structured logging (`@www/logger`).
- Tests: `bun run test` at repo root runs all vitest suites; scope with `bunx vitest run <path>` from the package dir.
- Work in a task-named worktree (`sonos-groups-modal`); no PRs; merge to `main` when green.
- Branch `worktree-mixer-stale-poll-reconcile` (WIP) also edits `SoundSystemTile.tsx` and changes `useMixer` to `useMixer(rooms, dataUpdatedAt)`. This plan does NOT touch `useMixer`; the only overlap is `SoundSystemTile.tsx`. Whichever lands second resolves a small conflict there.
- Real device constants (verified live 2026-07-11): Desk `RINCON_804AF28AAB2001400` @ `192.168.0.152`; Beam/Living Room `RINCON_74CA6093255801400` @ `192.168.0.193`.

---

### Task 1: Fix entity-encoded TrackMetaData in `getPositionInfo`

The bug: real firmware entity-encodes the `TrackMetaData` DIDL fragment; `getPositionInfo` runs `extractText` on it undecoded, so title/artist/art are always null for streaming sources (verified live against Bedroom Spotify). `getZoneGroupState` already handles this with `decodeXmlEntities` — mirror it.

**Files:**
- Modify: `products/control-center/api/src/integrations/sonos/client.ts:129`
- Test: `products/control-center/api/src/__tests__/sonos-client.test.ts`

**Interfaces:**
- Consumes: existing `extractText`, `decodeXmlEntities` helpers in `client.ts`.
- Produces: `getPositionInfo()` returning non-null `trackTitle`/`trackArtist`/`albumArtUri` for entity-encoded metadata. No signature change.

- [ ] **Step 1: Write the failing test**

Add to `sonos-client.test.ts` (reuse the file's existing `soapEnvelope` + `entityEncode` helpers and its fetch-stub pattern — copy the arrange/act shape of the nearest `getPositionInfo` test in that file):

```ts
it("getPositionInfo decodes entity-encoded TrackMetaData (real firmware shape)", async () => {
  const didl =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="-1" parentID="-1">' +
    "<dc:title>Bounce Back</dc:title><dc:creator>Ben Miller</dc:creator>" +
    "<upnp:albumArtURI>https://i.scdn.co/image/abc</upnp:albumArtURI>" +
    "</item></DIDL-Lite>";
  stubFetchOnce(
    soapEnvelope(`<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <Track>1</Track>
      <TrackDuration>0:03:38</TrackDuration>
      <TrackMetaData>${entityEncode(didl)}</TrackMetaData>
      <RelTime>0:00:30</RelTime>
    </u:GetPositionInfoResponse>`),
  );

  const info = await new SonosClient("192.168.0.63").getPositionInfo();

  expect(info.trackTitle).toBe("Bounce Back");
  expect(info.trackArtist).toBe("Ben Miller");
  expect(info.albumArtUri).toBe("https://i.scdn.co/image/abc");
});
```

(`stubFetchOnce` = whatever single-response fetch stub helper the file already uses — match its exact name; do not invent a second stubbing mechanism.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/sonos-client.test.ts`
Expected: new test FAILS with `expected null to be 'Bounce Back'`.

- [ ] **Step 3: Fix — decode before extracting**

In `client.ts` `getPositionInfo`, change the metadata block:

```ts
    if (rawMetadata && rawMetadata.trim().length > 0) {
      // TrackMetaData carries an entity-encoded DIDL-Lite fragment (same firmware
      // behavior as ZoneGroupState, www-51hf.56) , decode before extracting.
      const didl = decodeXmlEntities(rawMetadata);
      trackTitle = extractText(didl, "dc:title");
      trackArtist = extractText(didl, "dc:creator");
      albumArtUri = extractText(didl, "upnp:albumArtURI");
    }
```

- [ ] **Step 4: Run tests to verify pass (whole file — guard CDATA regressions)**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/sonos-client.test.ts`
Expected: ALL PASS. If a pre-existing CDATA-fixture test breaks, `decodeXmlEntities` must remain a no-op on already-decoded text — check its implementation before touching fixtures.

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/integrations/sonos/client.ts products/control-center/api/src/__tests__/sonos-client.test.ts
git commit -m "fix(control-center): decode entity-encoded TrackMetaData in getPositionInfo"
```

---

### Task 2: `SonosClient.getMediaInfo()`

**Files:**
- Modify: `products/control-center/api/src/integrations/sonos/client.ts` (new method, after `getPositionInfo`)
- Modify: `products/control-center/api/src/integrations/sonos/types.ts`
- Test: `products/control-center/api/src/__tests__/sonos-client.test.ts`

**Interfaces:**
- Consumes: private `soapRequest(path, service, action, body)`, `extractText`, `decodeXmlEntities`.
- Produces: `getMediaInfo(): Promise<MediaInfo>` with

```ts
/** Result of GetMediaInfo. currentUri is "" when the device has no source. */
export interface MediaInfo {
  /** Raw CurrentURI, e.g. "x-rincon-stream:RINCON_...:0"; empty string when idle. */
  currentUri: string;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
it("getMediaInfo returns the CurrentURI", async () => {
  stubFetchOnce(
    soapEnvelope(`<u:GetMediaInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <NrTracks>1</NrTracks>
      <CurrentURI>x-rincon-stream:RINCON_804AF28AAB2001400:0</CurrentURI>
      <PlayMedium>NETWORK</PlayMedium>
    </u:GetMediaInfoResponse>`),
  );
  const info = await new SonosClient("192.168.0.152").getMediaInfo();
  expect(info.currentUri).toBe("x-rincon-stream:RINCON_804AF28AAB2001400:0");
});

it("getMediaInfo returns empty currentUri for an idle device (verified live: empty element)", async () => {
  stubFetchOnce(
    soapEnvelope(`<u:GetMediaInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <NrTracks>0</NrTracks>
      <CurrentURI></CurrentURI>
      <PlayMedium>NONE</PlayMedium>
    </u:GetMediaInfoResponse>`),
  );
  const info = await new SonosClient("192.168.0.193").getMediaInfo();
  expect(info.currentUri).toBe("");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/sonos-client.test.ts`
Expected: FAIL `getMediaInfo is not a function`.

- [ ] **Step 3: Implement**

In `types.ts` add the `MediaInfo` interface above. In `client.ts`:

```ts
  /**
   * Returns the device's current transport source URI. The URI scheme
   * classifies the source (x-rincon-stream = line-in, x-sonos-htastream = TV,
   * x-rincon:<uuid> = following that group, "" = no source).
   */
  async getMediaInfo(): Promise<MediaInfo> {
    const xml = await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "GetMediaInfo",
      `<InstanceID>0</InstanceID>`,
    );
    return { currentUri: extractText(xml, "CurrentURI") ?? "" };
  }
```

Export `MediaInfo` from `products/control-center/api/src/integrations/sonos/index.ts` alongside the other type exports.

- [ ] **Step 4: Run tests** — same command, expected ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add products/control-center/api/src/integrations/sonos/
git add products/control-center/api/src/__tests__/sonos-client.test.ts
git commit -m "feat(control-center): SonosClient.getMediaInfo for source classification"
```

---

### Task 3: Source classification in the sound-system service + schema

**Files:**
- Modify: `products/control-center/api/src/services/sonos-sound-system-service.ts`
- Modify: `products/control-center/api/src/trpc/routers/media.ts:95` (`SoundSystemSchema`)
- Test: `products/control-center/api/src/__tests__/sonos-sound-system-service.test.ts`

**Interfaces:**
- Consumes: `SonosClient.getMediaInfo()` (Task 2), fixed `getPositionInfo()` (Task 1).
- Produces (used by Tasks 4/6/7):

```ts
export const DESK_LINE_IN_UUID = "RINCON_804AF28AAB2001400";
export const BEAM_UUID = "RINCON_74CA6093255801400";

export type SourceKind = "line-in" | "tv" | "spotify" | "airplay" | "other" | "idle";

/** Pure , classifies a coordinator's CurrentURI. Exported for tests. */
export function classifySourceUri(uri: string): SourceKind;

// SoundSystemRoom gains (all populated only on group coordinators; members
// carry their group's values so the web never re-joins):
//   sourceKind: SourceKind
//   trackTitle: string | null
//   trackArtist: string | null
//   albumArtUri: string | null
// sourceLabel: now populated ("Line-In" | "TV" | "Spotify" | "AirPlay" | null when idle/other)
```

- [ ] **Step 1: Write failing unit tests for `classifySourceUri`**

Add to `sonos-sound-system-service.test.ts`:

```ts
import { classifySourceUri } from "../services/sonos-sound-system-service";

describe("classifySourceUri", () => {
  it("classifies line-in", () => {
    expect(classifySourceUri("x-rincon-stream:RINCON_804AF28AAB2001400:0")).toBe("line-in");
  });
  it("classifies TV (htastream)", () => {
    expect(classifySourceUri("x-sonos-htastream:RINCON_74CA6093255801400:spdif")).toBe("tv");
  });
  it("classifies Spotify Connect vli sessions (verified live)", () => {
    expect(
      classifySourceUri("x-sonos-vli:RINCON_804AF28CFD6801400:2,spotify:da4995741e"),
    ).toBe("spotify");
  });
  it("classifies queue-based Spotify", () => {
    expect(classifySourceUri("x-rincon-queue:RINCON_X#0")).toBe("other");
    expect(classifySourceUri("x-sonos-spotify:spotify%3atrack%3a2JB6?sid=12")).toBe("spotify");
  });
  it("classifies AirPlay vli sessions", () => {
    expect(classifySourceUri("x-sonos-vli:RINCON_X:1,airplay:abc")).toBe("airplay");
  });
  it("empty URI is idle", () => {
    expect(classifySourceUri("")).toBe("idle");
  });
  it("follow URIs are idle for classification (the follower has no own source)", () => {
    expect(classifySourceUri("x-rincon:RINCON_804AF28AAB2001400")).toBe("idle");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/sonos-sound-system-service.test.ts`
Expected: FAIL — `classifySourceUri` not exported.

- [ ] **Step 3: Implement classification + service extension**

In `sonos-sound-system-service.ts`:

```ts
// Hardware source anchors (verified live 2026-07-11). Desk line-in jack and the
// Living Room Beam's TV/ARC input , the two always-rendered Groups sources.
export const DESK_LINE_IN_UUID = "RINCON_804AF28AAB2001400";
export const BEAM_UUID = "RINCON_74CA6093255801400";

export type SourceKind = "line-in" | "tv" | "spotify" | "airplay" | "other" | "idle";

/** Classifies a coordinator CurrentURI into a source kind. Pure. */
export function classifySourceUri(uri: string): SourceKind {
  if (uri === "" || uri.startsWith("x-rincon:")) return "idle";
  if (uri.startsWith("x-rincon-stream:")) return "line-in";
  if (uri.startsWith("x-sonos-htastream:")) return "tv";
  if (uri.startsWith("x-sonos-spotify:")) return "spotify";
  if (uri.startsWith("x-sonos-vli:")) {
    if (uri.includes(",spotify:")) return "spotify";
    if (uri.includes(",airplay:")) return "airplay";
    return "other";
  }
  return "other";
}

const SOURCE_LABELS: Record<SourceKind, string | null> = {
  "line-in": "Line-In",
  tv: "TV",
  spotify: "Spotify",
  airplay: "AirPlay",
  other: null,
  idle: null,
};
```

Extend `SoundSystemRoom` (replace the `sourceLabel` comment; add fields):

```ts
  /** Human source label from the group coordinator's stream, null when idle/unknown. */
  sourceLabel: string | null;
  /** Classified source kind of this room's group (coordinator's CurrentURI). */
  sourceKind: SourceKind;
  /** Now-playing metadata from the group coordinator; null when the source has none. */
  trackTitle: string | null;
  trackArtist: string | null;
  albumArtUri: string | null;
```

In `getSoundSystem()`, next to the shared `transportP`, add shared coordinator reads:

```ts
    const coordinatorClient = new SonosClient(coordinatorMember.ip);
    const transportP = coordinatorClient.getTransportInfo();
    const mediaP = coordinatorClient.getMediaInfo();
    const positionP = coordinatorClient.getPositionInfo();
```

and in the member mapper:

```ts
        const [volume, muted, transportInfo, mediaInfo, positionInfo] = await Promise.all([
          deviceClient.getVolume(),
          deviceClient.getMute(),
          transportP,
          mediaP,
          positionP,
        ]);
        const sourceKind = classifySourceUri(mediaInfo.currentUri);
        return {
          // ...existing fields unchanged...
          sourceLabel: SOURCE_LABELS[sourceKind],
          sourceKind,
          trackTitle: positionInfo.trackTitle,
          trackArtist: positionInfo.trackArtist,
          albumArtUri: positionInfo.albumArtUri,
        };
```

In `media.ts` extend `SoundSystemSchema`'s room object with:

```ts
    sourceKind: z.enum(["line-in", "tv", "spotify", "airplay", "other", "idle"]),
    trackTitle: z.string().nullable(),
    trackArtist: z.string().nullable(),
    albumArtUri: z.string().nullable(),
```

(`sourceLabel` is already in the schema as nullable string — verify, don't duplicate.)

- [ ] **Step 4: Fix any existing service tests** — the service test file stubs SonosClient; its fake must now also stub `getMediaInfo`/`getPositionInfo` per coordinator. Update fixtures with real-shaped URIs (line-in Desk, empty Living Room). Run: `cd products/control-center/api && bunx vitest run src/__tests__/sonos-sound-system-service.test.ts` — ALL PASS.

- [ ] **Step 5: Run the whole api suite + typecheck**

Run: `cd products/control-center/api && bun run test && cd ../../.. && bun run typecheck`
Expected: PASS (web may fail typecheck only if it consumed `SoundSystemRoom` exhaustively — fix consumers by adding the new fields where object literals are built, e.g. SoundSystemTile test fixtures).

- [ ] **Step 6: Commit**

```bash
git add products/control-center/api/src/services/sonos-sound-system-service.ts \
        products/control-center/api/src/trpc/routers/media.ts \
        products/control-center/api/src/__tests__/sonos-sound-system-service.test.ts
git commit -m "feat(control-center): classify group source + now-playing in soundSystem query"
```

---

### Task 4: `deriveSources` — pure source-list derivation (web)

**Files:**
- Create: `products/control-center/web/src/components/media/lib/derive-sources.ts`
- Test: `products/control-center/web/src/components/media/__tests__/derive-sources.test.ts`

**Interfaces:**
- Consumes: `SoundSystemRoom` rooms as delivered by `trpc.media.soundSystem` (fields from Task 3).
- Produces (consumed by Tasks 6/7):

```ts
export interface GroupSource {
  id: string;                    // "src_desk_linein" | "src_tv" | `src_session_${coordinatorUuid}`
  anchorUuid: string;            // coordinator uuid speakers join (x-rincon target)
  anchorIp: string;
  roomName: string;              // real zone name ("Desk", "Living Room", "Bedroom")
  label: string;                 // "Desk · Line-In", "Living Room · TV", "Bedroom · Spotify"
  kind: SourceKind;
  playing: boolean;              // group transportState === "PLAYING"
  trackLine: string | null;      // "Artist — Title" | app label | null (never fabricated)
  isSession: boolean;            // dynamic card (SESSION badge)
  colorVar: string;              // "--acc" | "--amber" | "--teal" | next in SESSION_HUES
}

export const SESSION_HUES = ["--teal"] as const; // v1: sessions cycle this list (one live session is the realistic case; add hues to tokens.css when needed). --teal does not exist in tokens.css yet , add `--teal: #6fdbcb;` next to --amber.
export function deriveSources(rooms: SoundSystemRoom[]): GroupSource[];
export function membershipByUuid(rooms: SoundSystemRoom[]): Record<string, string | null>; // room uuid -> GroupSource.id | null
```

Rules (from spec): hardware floor cards Desk·Line-In (`DESK_LINE_IN_UUID`) and Living Room·TV (`BEAM_UUID`) ALWAYS present, `playing` reflecting live state; session card per group coordinator whose `sourceKind` ∉ {"idle"} and whose (uuid, kind) isn't one of the two hardware cards; sources ordered [desk, tv, ...sessions by ROOM_ORDER rank of coordinator room, ties alphabetical]; colors: desk `--acc`, tv `--amber`, sessions from `SESSION_HUES` in source order. `membershipByUuid`: a room maps to the source whose anchorUuid === room's coordinatorUuid **and that source is live for follow purposes** (hardware card also matches while stopped iff room IS the anchor); rooms in idle groups map to null.

- [ ] **Step 1: Write failing tests** covering: silent house (2 floor cards, both `playing:false`, everyone else null membership); the live 3-source state from 2026-07-11 (Desk line-in playing, LR TV playing, Bedroom spotify session w/ trackLine "Twin Diplomacy — C'est La Vie"); dedup (Desk playing line-in does NOT also spawn a session card); ordering; color assignment; follower membership (Kitchen with coordinatorUuid = Desk maps to desk source id). Build room fixtures with a local `room(partial)` helper that fills defaults for every `SoundSystemRoom` field.

- [ ] **Step 2: Run to verify failure**

Run: `cd products/control-center/web && bunx vitest run src/components/media/__tests__/derive-sources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `derive-sources.ts`** — pure module, no React. Import `ROOM_ORDER` ranks by duplicating the service's order as a web constant `ROOM_ORDER = ["Living Room", "Desk", "Bedroom", "Bathroom", "Kitchen"]` with a comment pointing at the service (web cannot import api source). Hardware uuids: import from a new tiny constants file `products/control-center/web/src/components/media/lib/sonos-constants.ts` exporting `DESK_LINE_IN_UUID`, `BEAM_UUID` (same literals; comment: keep in sync with sonos-sound-system-service).

- [ ] **Step 4: Run tests — PASS.** Also `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add products/control-center/web/src/components/media/lib/ \
        products/control-center/web/src/components/media/__tests__/derive-sources.test.ts
git commit -m "feat(control-center): deriveSources for Groups modal (floor cards + sessions)"
```

---

### Task 5: `useGroupMembership` — optimistic membership with stale-poll gate

**Files:**
- Create: `products/control-center/web/src/components/media/hooks/useGroupMembership.ts`
- Test: `products/control-center/web/src/components/media/__tests__/useGroupMembership.test.ts`

**Interfaces:**
- Consumes: `membershipByUuid` (Task 4); react-query's `dataUpdatedAt` (epoch ms, 0 pre-data).
- Produces (consumed by Task 7):

```ts
export interface GroupMembershipState {
  /** room uuid -> source id | null, optimistic-first. */
  member: Record<string, string | null>;
  /** Optimistically set a room's source and stamp lastEditAt. */
  setMember: (uuid: string, sourceId: string | null) => void;
}
export function useGroupMembership(
  polled: Record<string, string | null>,
  dataUpdatedAt: number,
): GroupMembershipState;
```

Semantics — identical gating to `worktree-mixer-stale-poll-reconcile`'s useMixer: on `[polled, dataUpdatedAt]` change, per room: seed unknown rooms from poll; overwrite a known room only when `dataUpdatedAt > lastEditAt[uuid]`; prune rooms absent from the poll; stable reference when nothing changed.

- [ ] **Step 1: Write failing tests** with `@testing-library/react` `renderHook` (same harness as `useMixer.test.ts` — copy its setup): seeds from first poll; optimistic `setMember` survives a stale snapshot (same `dataUpdatedAt`); a newer snapshot (`dataUpdatedAt` advanced past the edit's `Date.now()` — use `vi.useFakeTimers` + `vi.setSystemTime` exactly like `useMixer.test.ts` does) overwrites; pruning.

- [ ] **Step 2: Run — FAIL (module not found).**
Run: `cd products/control-center/web && bunx vitest run src/components/media/__tests__/useGroupMembership.test.ts`

- [ ] **Step 3: Implement** — mirror `useMixer`'s reconcile effect structure (`lastEditAt` ref keyed by uuid, `Date.now()` stamp in `setMember`, `changed ? next : prev` stable-reference guard).

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add products/control-center/web/src/components/media/hooks/useGroupMembership.ts \
        products/control-center/web/src/components/media/__tests__/useGroupMembership.test.ts
git commit -m "feat(control-center): useGroupMembership with stale-poll reconcile gate"
```

---

### Task 6: `GroupsModalView` — presentational patch bay + stories

**Files:**
- Create: `products/control-center/web/src/components/media/GroupsModalView.tsx`
- Create: `products/control-center/web/src/components/media/GroupsModalView.stories.tsx`

**Interfaces:**
- Consumes: `GroupSource` (Task 4), `Modal` from `@/components/ui`.
- Produces (consumed by Task 7):

```ts
export interface GroupsModalViewProps {
  open: boolean;
  onClose: () => void;
  sources: GroupSource[];
  /** room uuid -> source id | null (optimistic state from useGroupMembership). */
  member: Record<string, string | null>;
  /** Rooms to list in the speaker column, already in display order. */
  speakers: Array<{ uuid: string; name: string }>;
  selectedSourceId: string;
  onSelectSource: (sourceId: string) => void;
  /** Tap a speaker row: container decides join vs leave from `member`. */
  onTapSpeaker: (uuid: string) => void;
  /** ALL button on the selected source. */
  onAll: () => void;
}
```

Visual spec (mock-final, D1): two columns (`Sources` flex 1.25 / `Speakers` flex 1, gap 20, col labels 10px/700/.08em uppercase ink-3). Source card: tile-2 bg, hairline border, radius 12; selected → border `--sc-line` + bg `--sc-dim` + 10px jack dot centered on the right edge (absolute, `right: -25px`); room name 13/600 + SESSION badge (9px/700, nest bg) when `isSession`; status line 10px ink-3 = `label-detail · trackLine` (no "PLAYING" text ever); 3 EQ bars (3px wide, `--sc`, `@keyframes eq` height 4→14px) top-right while `playing`, staggered deterministically: hash source id → `base = (h % 40)/100`s, `dur = 0.85 + ((h>>3)%30)/100`s, bar i delay `base + i*0.18`s; hidden when not playing; `prefers-reduced-motion` → static 8px bars. ALL button (11px/600, `--sc-dim` bg, `--sc` text) renders inside the selected card only. Speaker row: tile-2, radius 12, 8px LED dot — bg/border/8px glow in the followed source's `colorVar`, nest+hairline when off; source room-name right-aligned 10px ink-3 ("off" when null); the selected source's anchor row `disabled` + opacity .7. Per-source color via CSS custom props: card/row gets `style={{ "--sc": \`var(${source.colorVar})\` } as CSSProperties}` and classes reference `var(--sc)` / `color-mix(in srgb, var(--sc) 14%, transparent)` for dim, `45%` for line (matches Evee token derivation).

- [ ] **Step 1: Build the component** — pure presentational, inline styles + one `<style>` block for keyframes (match how sibling media components style; check `QuickPlayTileView.tsx` for the established pattern of animation styles first and mirror it).

- [ ] **Step 2: Stories** — `GroupsModalView.stories.tsx` mirroring `FavoritesModal.stories.tsx` conventions. Stories (real-data fixtures from 2026-07-11 live reads, no invented tracks): `FloorSilent` (2 stopped hardware cards, all speakers off), `TwoLive` (desk line-in + TV playing, LR on tv / desk on desk), `ThreeWithSession` (adds Bedroom spotify session, trackLine "Twin Diplomacy — C'est La Vie"), `MidPatch` (kitchen+bath on desk source, TV selected).

- [ ] **Step 3: Verify in Storybook**

Run: `cd products/control-center/web && bun run storybook -- --ci --port 6006` (background) then screenshot each story via the browser (agent: `cmux browser open http://localhost:6006/?path=/story/media-groupsmodalview--three-with-session` + `cmux browser screenshot`). Confirm: EQ bars out of phase between cards, jack only on selected, LED colors match followed source, anchor row disabled.

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add products/control-center/web/src/components/media/GroupsModalView.tsx \
        products/control-center/web/src/components/media/GroupsModalView.stories.tsx
git commit -m "feat(control-center): GroupsModalView patch-bay presentational + stories"
```

---

### Task 7: Container + Sound System tile launcher

**Files:**
- Create: `products/control-center/web/src/components/media/GroupsModal.tsx` (container)
- Modify: `products/control-center/web/src/components/media/SoundSystemTile.tsx` (third modal + launcher prop)
- Modify: `products/control-center/web/src/components/media/SoundSystemTileView.tsx` (header launcher button `onOpenGroups`)
- Test: `products/control-center/web/src/components/media/__tests__/GroupsModal.test.tsx`

**Interfaces:**
- Consumes: everything above; `trpc.media.sonosGroupJoin/sonosGroupLeave/sonosGrabTvToBeam` mutations; `trpc.media.soundSystem` query data + `dataUpdatedAt` already fetched by `SoundSystemTile` (pass down — do NOT run a second poll).
- Produces: `<GroupsModal open onClose rooms dataUpdatedAt />` where `rooms: SoundSystemRoom[]`.

Container logic:

```
sources = deriveSources(rooms)
membership = useGroupMembership(membershipByUuid(rooms), dataUpdatedAt)
selectedSourceId state (default: first playing source, else "src_desk_linein")
onTapSpeaker(uuid):
  s = selected source; room = rooms.find(uuid)
  if member[uuid] === s.id → leave: setMember(uuid,null); groupLeave.mutate({memberIp room.deviceIp, memberUuid uuid})
  else → join: setMember(uuid, s.id)
       if s.kind === "tv" and the beam room's sourceKind !== "tv" → grabTv.mutate({beamIp, beamUuid: BEAM_UUID}) first (fire, then join in .onSuccess? No — sequential await via mutateAsync: grab first, then join; log failure via mutation error state)
       groupJoin.mutate({memberIp: room.deviceIp, coordinatorUuid: s.anchorUuid})
  finally: utils.media.soundSystem.invalidate()
onAll(): for each speaker not anchor-of-another-source and member!==s.id → same join path
Anchor guard: speakers list marks the selected source's anchor disabled (view already does); container never emits join/leave for it.
```

- [ ] **Step 1: Write failing container tests** — vitest + testing-library, mock tRPC exactly the way `__tests__/SoundSystemTile.test.tsx` mocks it (reuse its `trpc` mock module pattern verbatim). Cases: tap idle speaker fires `sonosGroupJoin` with the selected source's `anchorUuid` + optimistic LED (assert via `aria` state); tap member fires `sonosGroupLeave`; tap speaker while TV selected and beam idle fires `sonosGrabTvToBeam` BEFORE `sonosGroupJoin` (assert call order); ALL joins every non-anchor; each mutation invalidates `soundSystem`.

- [ ] **Step 2: Run — FAIL.**
Run: `cd products/control-center/web && bunx vitest run src/components/media/__tests__/GroupsModal.test.tsx`

- [ ] **Step 3: Implement container + wire tile.** In `SoundSystemTile.tsx`: `const [groupsOpen, setGroupsOpen] = useState(false)`, render `<GroupsModal open={groupsOpen} onClose={...} rooms={data.rooms} dataUpdatedAt={dataUpdatedAt} />` (the query already exposes `dataUpdatedAt` on this branch after `worktree-mixer-stale-poll-reconcile`; if building before it lands, destructure `dataUpdatedAt` from the same `useQuery` — same one-liner, no conflict of substance). In `SoundSystemTileView`: add `onOpenGroups: () => void` prop + a third header icon button (link/group glyph, same `faderBtn`-style as existing header buttons, `aria-label="Open groups"`).

- [ ] **Step 4: Run — PASS.** Then full gates: `bun run test && bun run typecheck && bun run lint && bun run knip`
Expected: all green (knip: new files are imported, no dead exports — remove unused `SESSION_HUES` members if flagged).

- [ ] **Step 5: Commit**

```bash
git add products/control-center/web/src/components/media/
git commit -m "feat(control-center): Groups modal wired into Sound System tile"
```

---

### Task 8: End-to-end verify on real hardware + docs

**Files:**
- Modify: `CODEBASE_OVERVIEW.md` (media section: mention Groups modal) — keep docs current per repo rule.

- [ ] **Step 1: Run the dev stack** (`bun run dev`) and open the board in a browser (`cmux browser open http://localhost:<dev port>` — port from dev script output).

- [ ] **Step 2: Real-device verification script (read current state first):**
1. Open Groups modal — expect floor cards Desk·Line-In and Living Room·TV plus any live session, matching `bun run <scratchpad>/sonos-now.ts` output.
2. Select Desk source, tap Kitchen → Kitchen audibly plays desk line-in within ~2s; LED goes blue; poll does not snap it back (watch ≥15s).
3. Tap Kitchen again → drops off, goes silent.
4. Select TV, tap Bathroom with TV idle → Beam grabs ARC then Bathroom joins (verify call order in devtools network tab).
5. ALL on Desk → everything except Living Room (TV anchor, if TV live) joins.
6. Restore original topology (leave everything as found: all solo unless the user says otherwise).

- [ ] **Step 3: Update `CODEBASE_OVERVIEW.md`** media/control-center paragraph: one sentence — Groups modal (patch-bay) moves speakers between live sources; sound-system query now carries `sourceKind` + now-playing.

- [ ] **Step 4: Final gates + merge**

```bash
bun run test && bun run typecheck && bun run lint && bun run knip
# from the MAIN checkout (never push from a worktree , bd/dolt hook scar tissue):
git -C /Users/calum/code/github.com/0x63616c/world-wide-webb merge --ff-only <worktree-branch>
git -C /Users/calum/code/github.com/0x63616c/world-wide-webb push --no-verify
```

Push to `main` triggers CI + product-aware deploy (web + api images).

- [ ] **Step 5: Coordinate with `worktree-mixer-stale-poll-reconcile`** — if it hasn't landed, tell Calum the `SoundSystemTile.tsx` conflict is expected and trivial (both add props to the same call site).
