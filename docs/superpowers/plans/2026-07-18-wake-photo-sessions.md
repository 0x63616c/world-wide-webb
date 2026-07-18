# Wake-Photo Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correlate the front-camera wake burst with the interaction log so a visit to the wall panel reads back as one object — the photo of who walked up, and the transcript of what they did.

**Architecture:** The interaction session id (already shipped, `lib/log/interaction.ts`) becomes the correlation key. Its boundary moves from a 60s inactivity timeout to the physical undim event, which is the same instant the camera fires. Wake photos gain a real Postgres index row (`wake_photo`) carrying that session id, replacing today's filesystem-tree-as-database. Sessions themselves are **derived by aggregation** over `frontend_log` where `source='ui'` — NOT stored in their own table — because `session/start` / `session/end` entries already carry every attribute a session has, and the existing log shipping is idempotent and backfills offline windows. A second write path for session rows could drift from the log; an aggregate cannot.

**Tech Stack:** Bun, tRPC, drizzle-orm + drizzle-kit (Postgres), React 19, vitest, Storybook.

## Global Constraints

- Fixed wall panel, `1366x1024`, not responsive.
- Use shared UI primitives from `products/control-center/web/src/components/ui/`.
- No fake or placeholder data.
- Storybook-first for new UI: every new view component needs a `*.stories.tsx` (enforced by the `storybook-docs` lefthook guard + CI).
- IDs default to `prefix_<id>`. Session ids are `isn_<12 hex>`.
- Backend code uses structured logging (`@www/logger`), never `console.*`.
- Presentational split: data-fetching container (`XTile.tsx`) vs pure view (`XTileView.tsx`) taking props.
- After `bun run db:generate`, run `bunx biome format --write products/control-center/api/src/db/migrations/meta` before committing — generated meta JSON otherwise fails `bun run lint`.
- `git push` currently requires `--no-verify`: the repo-wide pre-push lint gate fails on pre-existing errors in `infra/cloudflare/*` and `packages/platform/test/secrets.test.ts` that are unrelated to this work.

---

### Task 1: Move the session boundary to undim

Today a session opens on the first interaction and closes after 60s of silence. That is an inference. The undim event is a physical fact — someone approached a dark panel — and it is the exact instant `captureWakeBurst()` already fires. Make undim the primary boundary and keep the timeout only as a fallback for environments that never dim (browser, Storybook, `idleDimEnabled: false`).

**Files:**
- Modify: `products/control-center/web/src/lib/log/interaction.ts`
- Modify: `products/control-center/web/src/components/Board.tsx` (the `wake` callback, ~line 727)
- Test: `products/control-center/web/src/lib/__tests__/log-interaction.test.ts`

**Interfaces:**
- Consumes: `interaction()`, `endInteractionSession()` from `lib/log/interaction.ts` (already shipped).
- Produces:
  - `startInteractionSession(): string` — force-opens a NEW session (ending any live one first) and returns its id. Called from `wake()`.
  - `currentInteractionSessionId(): string | null` — the live session id, or null. Used by Task 2's upload path.

- [ ] **Step 1: Write the failing tests**

Add to `products/control-center/web/src/lib/__tests__/log-interaction.test.ts`, inside the existing `describe("interaction logging")` block. Note the imports at the top of the file must gain `startInteractionSession` and `currentInteractionSessionId`.

```ts
  it("startInteractionSession always mints a fresh id, ignoring the resume window", () => {
    interaction("tile", "tap", "tile_clock");
    const first = sessionIdOf(uiSince(mark)[0]);
    endInteractionSession("idle-dim");

    // Well inside the 30s resume window — but an undim is a NEW visit, so the
    // physical boundary must win over the timing heuristic.
    vi.advanceTimersByTime(5_000);
    const next = startInteractionSession();
    expect(next).not.toBe(first);
    expect(next).toMatch(/^isn_[0-9a-f]{12}$/);
  });

  it("startInteractionSession closes a live session before opening the next", () => {
    interaction("tile", "tap", "tile_clock");
    startInteractionSession();
    const ends = uiSince(mark).filter((e) => e.msg === "session/end");
    expect(ends).toHaveLength(1);
    expect(ends[0].data).toMatchObject({ reason: "superseded" });
  });

  it("exposes the live session id, and null once it ends", () => {
    expect(currentInteractionSessionId()).toBeNull();
    interaction("tile", "tap", "tile_clock");
    expect(currentInteractionSessionId()).toBe(sessionIdOf(uiSince(mark)[0]));
    endInteractionSession("idle-dim");
    expect(currentInteractionSessionId()).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd products/control-center/web && bunx vitest run src/lib/__tests__/log-interaction.test.ts
```

Expected: FAIL — `startInteractionSession is not a function` / `currentInteractionSessionId is not a function`.

- [ ] **Step 3: Implement the two new exports**

In `products/control-center/web/src/lib/log/interaction.ts`, append after `endInteractionSession`:

```ts
/**
 * Force-open a NEW session, ending any live one first.
 *
 * Called on undim. An undim is a PHYSICAL boundary , someone walked up to a
 * dark panel , so it outranks the resume window, which exists only to stitch
 * together a visit that timing alone would have split. Deliberately does not
 * consult `lastSessionId`: a fresh approach is a fresh visit even if the last
 * one ended two seconds ago.
 *
 * Returns the id so the caller can hand it to the wake-photo upload, which is
 * what makes a photo and a transcript the same visit.
 */
export function startInteractionSession(): string {
  endInteractionSession("superseded");
  const now = Date.now();
  sessionId = newSessionId();
  sessionIdx = 0;
  sessionStartedAt = now;
  // Suppress the resume path for the interaction that follows this wake , the
  // session we just minted IS the one it belongs to.
  lastEndedAt = null;
  lastSessionId = null;
  uiLog.info("session/start", { interactionSessionId: sessionId, idx: 0 });
  armIdleTimer();
  return sessionId;
}

/**
 * The live session id, or null when no visit is in progress.
 *
 * Read by the wake-photo upload so each burst frame carries the session it
 * belongs to. Null is a legitimate answer (a burst can fire microseconds before
 * the session opens in a odd ordering, or dimming is disabled entirely) , the
 * upload path treats it as "unattributed", never as an error.
 */
export function currentInteractionSessionId(): string | null {
  return sessionId;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd products/control-center/web && bunx vitest run src/lib/__tests__/log-interaction.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Wire it into the wake path**

In `products/control-center/web/src/components/Board.tsx`, replace the body of the `wake` callback's logging line. It currently reads:

```tsx
    if (nativeDisplay) captureWakeBurst();
    // Opens (or resumes, inside the grace window) the interaction session, so a
    // visit's transcript begins at the approach rather than at the first tap.
    interaction("session", "wake", "panel");
    wakeDim();
```

Replace with:

```tsx
    // Order matters: mint the session FIRST so the burst's frames can carry it.
    // An undim is the physical start of a visit, so it opens a new session
    // outright rather than resuming , see startInteractionSession.
    const sessionId = startInteractionSession();
    if (nativeDisplay) captureWakeBurst(sessionId);
    interaction("session", "wake", "panel");
    wakeDim();
```

Update the import on line 15:

```tsx
import {
  endInteractionSession,
  interaction,
  startInteractionSession,
} from "../lib/log/interaction";
```

`captureWakeBurst` gains its parameter in Task 2; until then TypeScript will error on the extra argument. That is expected and is fixed by Task 2 — do NOT commit between these. Continue to Task 2 before committing.

---

### Task 2: Carry the session id through the upload and index photos in Postgres

The filesystem is currently the entire wake-photo store: `wake-photos/YYYY/MM/DD/<capturedAt>-<n>.jpg`, with `<n>` a same-millisecond collision counter (NOT a frame index — burst frames land ~600ms apart, so it is essentially always `0`). A timestamp in a filename is the only metadata that exists. Add a real index row per photo while keeping the bytes on disk.

**Files:**
- Modify: `products/control-center/web/src/lib/wake-capture.ts`
- Modify: `products/control-center/api/src/db/schema.ts`
- Modify: `products/control-center/api/src/services/wake-photo-service.ts`
- Modify: `products/control-center/api/src/server.ts:101-118`
- Create: `products/control-center/api/src/db/migrations/0015_wake_photo.sql` (generated)
- Test: `products/control-center/web/src/lib/__tests__/wake-capture.test.ts`
- Test: `products/control-center/api/src/services/wake-photo-service.test.ts`

**Interfaces:**
- Consumes: `currentInteractionSessionId()` from Task 1.
- Produces:
  - `captureWakeBurst(sessionId: string | null, runner?: () => Promise<void>): void`
  - `saveWakePhoto(db, bytes, meta: WakePhotoMeta, root?): Promise<string>` where
    `WakePhotoMeta = { capturedAt: number; deviceId: string | null; sessionId: string | null; frameIdx: number }`
  - table `wakePhoto` exported from `api/src/db/schema.ts`

- [ ] **Step 1: Write the failing client test**

Append to `products/control-center/web/src/lib/__tests__/wake-capture.test.ts`:

```ts
  it("sends the session id and frame index on every uploaded frame", async () => {
    const calls: { sessionId: string | null; frameIdx: string | null }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({
        sessionId: headers["x-session-id"] ?? null,
        frameIdx: headers["x-frame-idx"] ?? null,
      });
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await uploadBurstFramesForTests("isn_abc123abc123", [
      new Blob(["a"], { type: "image/jpeg" }),
      new Blob(["b"], { type: "image/jpeg" }),
    ]);

    expect(calls).toEqual([
      { sessionId: "isn_abc123abc123", frameIdx: "0" },
      { sessionId: "isn_abc123abc123", frameIdx: "1" },
    ]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd products/control-center/web && bunx vitest run src/lib/__tests__/wake-capture.test.ts
```

Expected: FAIL — `uploadBurstFramesForTests is not exported`.

- [ ] **Step 3: Thread the session id through the client**

In `products/control-center/web/src/lib/wake-capture.ts`, replace `uploadFrame` and adjust `runBurst` / `captureWakeBurst`:

```ts
async function uploadFrame(
  blob: Blob,
  sessionId: string | null,
  frameIdx: number,
): Promise<{ ok: boolean; status: number }> {
  const headers: Record<string, string> = {
    "Content-Type": "image/jpeg",
    "x-captured-at": String(Date.now()),
    "x-frame-idx": String(frameIdx),
  };
  // Omitted rather than sent empty when there is no live session: an absent
  // header is unambiguously "unattributed", where "" would be a session id that
  // sorts and groups like a real one.
  if (sessionId) headers["x-session-id"] = sessionId;
  const res = await fetch("/media/wake-photo", { method: "POST", headers, body: blob });
  return { ok: res.ok, status: res.status };
}

/** Test seam: exercise the upload headers without a camera. */
export async function uploadBurstFramesForTests(
  sessionId: string | null,
  blobs: Blob[],
): Promise<void> {
  for (const [i, blob] of blobs.entries()) await uploadFrame(blob, sessionId, i);
}
```

In `runBurst`, change the signature to `async function runBurst(sessionId: string | null): Promise<void>` and the loop to track the index:

```ts
    let uploaded = 0;
    let elapsed = 0;
    for (const [frameIdx, at] of BURST_DELAYS_MS.entries()) {
      await sleep(at - elapsed);
      elapsed = at;
      const blob = await grabFrame(video);
      if (!blob) {
        wakeLog.warn("frame grab returned nothing", { at });
        continue;
      }
      const res = await uploadFrame(blob, sessionId, frameIdx);
      if (res.ok) uploaded += 1;
      else wakeLog.warn("frame upload rejected", { at, status: res.status, bytes: blob.size });
    }
```

And the public entrypoint:

```ts
export function captureWakeBurst(
  sessionId: string | null,
  runner: (sessionId: string | null) => Promise<void> = runBurst,
): void {
  if (burstInFlight) return;
  burstInFlight = true;
  runner(sessionId)
    .catch((err) =>
      wakeLog.warn("burst failed", {
        name: err instanceof Error ? err.name : "unknown",
        message: err instanceof Error ? err.message : String(err),
      }),
    )
    .finally(() => {
      burstInFlight = false;
    });
}
```

- [ ] **Step 4: Run client tests to verify they pass**

```bash
cd products/control-center/web && bunx vitest run src/lib/__tests__/wake-capture.test.ts src/components/__tests__/Board.dim-overlay.test.tsx
```

Expected: PASS. If `Board.dim-overlay.test.tsx` fails on the mock's arity, update its `captureWakeBurst` mock to accept the session id argument.

- [ ] **Step 5: Add the schema table**

Append to `products/control-center/api/src/db/schema.ts`, after the `frontendLog` table:

```ts
// Wake photos (spec docs/specs/2026-07-18-interaction-logging-design.md). The
// front-camera burst frames the panel uploads on every undim. The BYTES stay on
// disk (<MEDIA_STORAGE_DIR>/wake-photos/YYYY/MM/DD/...); this table is the index
// over them, which the dated directory tree used to serve implicitly.
//
// It exists for three things the tree could not do: correlate a frame with the
// interaction session it belongs to, attribute a frame to a device, and give
// retention a cheap cutoff query instead of a full-tree walk.
//
// `interactionSessionId` is a PLAIN COLUMN, not a foreign key. There is no
// sessions table by design (sessions are derived from frontend_log), and even if
// there were, the photo uploads immediately over HTTP while the log ships on a
// 3s batch that backfills across offline windows , so the photo routinely lands
// BEFORE the session it names. A soft reference tolerates that ordering; an FK
// would reject the insert.
export const wakePhoto = pgTable(
  "wake_photo",
  {
    // Path relative to the wake-photos root, e.g. "2026/07/18/1752849600000-0.jpg".
    // Also the id: it is what GET /media/wake-photos/<path> serves, and the
    // filesystem already guarantees it is unique.
    path: text("path").primaryKey(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    // Nullable: bursts uploaded before this column existed, and any burst that
    // fires with no live session, are legitimately unattributed.
    interactionSessionId: text("interaction_session_id"),
    // Nullable for the same backfill reason. Matches frontend_log.device_id.
    deviceId: text("device_id"),
    // 0-based position within its burst. Nullable for backfilled rows, where the
    // information does not exist , the old filename suffix was a same-millisecond
    // collision counter, not a frame index.
    frameIdx: integer("frame_idx"),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The Sessions view's primary read: every frame of one visit.
    index("wake_photo_session_idx").on(t.interactionSessionId),
    // Day-grouped listing (the existing viewer) and the retention cutoff.
    index("wake_photo_captured_at_idx").on(t.capturedAt),
  ],
);
```

Ensure `integer` is in the drizzle import at the top of `schema.ts`; add it if absent.

- [ ] **Step 6: Generate and format the migration**

```bash
cd products/control-center/api && bun run db:generate
bunx biome format --write src/db/migrations/meta
```

Expected: a new `src/db/migrations/0015_*.sql` containing `CREATE TABLE "wake_photo"`. Read it and confirm it creates the two indexes.

- [ ] **Step 7: Write the failing service test**

Append to `products/control-center/api/src/services/wake-photo-service.test.ts`:

```ts
  it("records an index row carrying the session, device and frame index", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);
    const capturedAt = Date.UTC(2026, 6, 18, 12, 0, 0);
    const path = await saveWakePhoto(
      db,
      jpeg,
      { capturedAt, deviceId: "ipad13-1-3f9a2c1b", sessionId: "isn_abc123abc123", frameIdx: 1 },
      root,
    );

    const [row] = await db.select().from(wakePhoto).where(eq(wakePhoto.path, path));
    expect(row).toMatchObject({
      path,
      interactionSessionId: "isn_abc123abc123",
      deviceId: "ipad13-1-3f9a2c1b",
      frameIdx: 1,
      bytes: jpeg.length,
    });
    expect(row.capturedAt.getTime()).toBe(capturedAt);
  });

  it("stores the bytes even when there is no session to attribute them to", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const path = await saveWakePhoto(
      db,
      jpeg,
      { capturedAt: Date.UTC(2026, 6, 18, 13, 0, 0), deviceId: null, sessionId: null, frameIdx: 0 },
      root,
    );
    const [row] = await db.select().from(wakePhoto).where(eq(wakePhoto.path, path));
    expect(row.interactionSessionId).toBeNull();
    expect(await readWakePhoto(path, root)).not.toBeNull();
  });
```

The existing test file's setup will need a `db` handle. Follow whatever pattern the other db-touching service tests in `products/control-center/api/src/services/` already use for a test database — read one (e.g. `frontend-log-service.test.ts`) and copy its setup verbatim rather than inventing a new one.

- [ ] **Step 8: Run it to verify it fails**

```bash
cd products/control-center/api && bunx vitest run src/services/wake-photo-service.test.ts
```

Expected: FAIL — `saveWakePhoto` takes the old `(bytes, capturedAt, root)` signature.

- [ ] **Step 9: Implement the service change**

In `products/control-center/api/src/services/wake-photo-service.ts`, replace `saveWakePhoto`:

```ts
export interface WakePhotoMeta {
  capturedAt: number;
  deviceId: string | null;
  sessionId: string | null;
  frameIdx: number;
}

/**
 * Validate and persist one burst frame: bytes to disk, index row to Postgres.
 *
 * Disk write happens FIRST. If the row insert then fails we are left with an
 * unindexed file, which the backfill (see backfillWakePhotoIndex) heals; the
 * reverse order would leave a row pointing at bytes that do not exist, which
 * nothing can heal and which 404s in the viewer.
 */
export async function saveWakePhoto(
  db: NodePgDatabase<typeof schema>,
  bytes: Uint8Array,
  meta: WakePhotoMeta,
  root = defaultRoot(),
): Promise<string> {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`wake photo too large: ${bytes.length} bytes (max ${MAX_BYTES})`);
  }
  if (bytes.length < JPEG_MAGIC.length || !JPEG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("wake photo is not a JPEG");
  }
  const { rel } = dayDirFor(meta.capturedAt);
  const dir = join(root, rel);
  await mkdir(dir, { recursive: true });
  const existing = (await readdir(dir)).filter((f) => f.startsWith(`${meta.capturedAt}-`));
  const relPath = join(rel, `${meta.capturedAt}-${existing.length}.jpg`);
  await writeFile(join(root, relPath), bytes);

  await db
    .insert(wakePhoto)
    .values({
      path: relPath,
      capturedAt: new Date(meta.capturedAt),
      interactionSessionId: meta.sessionId,
      deviceId: meta.deviceId,
      frameIdx: meta.frameIdx,
      bytes: bytes.length,
    })
    // A same-path retry re-uploads identical bytes; the row is already correct.
    .onConflictDoNothing();

  getLogger().info(
    { relPath, bytes: bytes.length, sessionId: meta.sessionId },
    "wake photo stored",
  );
  return relPath;
}
```

Add the imports `import { eq } from "drizzle-orm"; import type { NodePgDatabase } from "drizzle-orm/node-postgres"; import type * as schema from "../db/schema"; import { wakePhoto } from "../db/schema";` at the top.

- [ ] **Step 10: Update the route to pass the new headers**

In `products/control-center/api/src/server.ts`, replace the POST branch body (lines ~101-118):

```ts
  if (url.pathname === "/media/wake-photo" && req.method === "POST") {
    const headerTs = Number(req.headers.get("x-captured-at"));
    const capturedAt = Number.isFinite(headerTs) && headerTs > 0 ? headerTs : Date.now();
    const frameHeader = Number(req.headers.get("x-frame-idx"));
    const frameIdx = Number.isFinite(frameHeader) && frameHeader >= 0 ? frameHeader : 0;
    const bytes = new Uint8Array(await req.arrayBuffer());
    try {
      const path = await saveWakePhoto(db, bytes, {
        capturedAt,
        frameIdx,
        deviceId: req.headers.get("x-device-id"),
        sessionId: req.headers.get("x-session-id"),
      });
      return Response.json({ path }, { status: 201, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "invalid wake photo", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
  }
```

Import `db` from `./db/index` if not already imported in `server.ts`.

Also send `x-device-id` from the client — in `wake-capture.ts`'s `uploadFrame`, add `"x-device-id": getDeviceId(),` to the headers object and `import { getDeviceId } from "./device-id";` at the top.

- [ ] **Step 11: Run all affected tests**

```bash
cd products/control-center/api && bunx vitest run src/services/wake-photo-service.test.ts
cd ../web && bunx vitest run --testTimeout=20000 src/lib src/components/__tests__
```

Expected: PASS on both.

- [ ] **Step 12: Typecheck, lint, commit**

```bash
cd /Users/calum/code/github.com/0x63616c/world-wide-webb
bun run typecheck 2>&1 | grep -E "control-center|platform"
bunx biome check --write products/control-center/api/src products/control-center/web/src
git add products/control-center docs
git commit -m "feat(control-center): index wake photos in postgres with their session id"
git push --no-verify origin main
```

`bun run typecheck` must report `@control-center/web` and `@control-center/api` at code 0. Pre-existing `@www/infra` / `@www/platform` failures are unrelated — do not attempt to fix them here.

---

### Task 3: Backfill existing photos and switch listing to SQL

Every photo already on disk has no index row. Until they do, the Sessions view and any DB-driven listing silently omit the entire history. Backfill once at migration time, then make the listing read from the table so the tree walk stops being load-bearing.

**Files:**
- Modify: `products/control-center/api/src/services/wake-photo-service.ts`
- Test: `products/control-center/api/src/services/wake-photo-service.test.ts`

**Interfaces:**
- Consumes: `wakePhoto` table, `listWakePhotos` (existing shape).
- Produces: `backfillWakePhotoIndex(db, root?): Promise<{ inserted: number; scanned: number }>`. `listWakePhotos(db, root?)` keeps returning the identical `WakePhotoListing` shape so `WakePhotoViewer` and `WakesTile` need no change.

- [ ] **Step 1: Write the failing test**

```ts
  it("backfills index rows for photos already on disk, and is idempotent", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x09]);
    const dir = join(root, "2026", "07", "18");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "1752840000000-0.jpg"), jpeg);

    const first = await backfillWakePhotoIndex(db, root);
    expect(first).toEqual({ scanned: 1, inserted: 1 });

    const [row] = await db.select().from(wakePhoto);
    // Unattributed by construction: the filename never carried a session.
    expect(row.interactionSessionId).toBeNull();
    expect(row.frameIdx).toBeNull();
    expect(row.capturedAt.getTime()).toBe(1752840000000);

    const second = await backfillWakePhotoIndex(db, root);
    expect(second).toEqual({ scanned: 1, inserted: 0 });
  });

  it("lists from the index, newest day first", async () => {
    await saveWakePhoto(
      db,
      new Uint8Array([0xff, 0xd8, 0xff, 0x01]),
      { capturedAt: Date.UTC(2026, 6, 17, 9, 0, 0), deviceId: null, sessionId: null, frameIdx: 0 },
      root,
    );
    await saveWakePhoto(
      db,
      new Uint8Array([0xff, 0xd8, 0xff, 0x02]),
      { capturedAt: Date.UTC(2026, 6, 18, 9, 0, 0), deviceId: null, sessionId: null, frameIdx: 0 },
      root,
    );

    const listing = await listWakePhotos(db, root);
    expect(listing.days.map((d) => d.day)).toEqual(["2026-07-18", "2026-07-17"]);
    expect(listing.totalCount).toBe(2);
    expect(listing.totalBytes).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd products/control-center/api && bunx vitest run src/services/wake-photo-service.test.ts
```

Expected: FAIL — `backfillWakePhotoIndex is not a function`.

- [ ] **Step 3: Implement backfill + SQL listing**

Add to `wake-photo-service.ts`:

```ts
/**
 * Index every photo on disk that has no row yet.
 *
 * The filesystem was the store for the whole life of this feature, so history
 * predates the table. Idempotent (`onConflictDoNothing` on the path PK) so it is
 * safe to run on every api boot , which is how it runs, rather than as a
 * one-shot script someone has to remember to invoke.
 *
 * Backfilled rows are honestly incomplete: the old filename encoded only a
 * capture timestamp, so session, device and frame index are all NULL. That is
 * the truth about those photos and the viewer renders them as unattributed
 * rather than guessing.
 */
export async function backfillWakePhotoIndex(
  db: NodePgDatabase<typeof schema>,
  root = defaultRoot(),
): Promise<{ inserted: number; scanned: number }> {
  const onDisk = await walkPhotoFiles(root);
  if (onDisk.length === 0) return { inserted: 0, scanned: 0 };

  let inserted = 0;
  for (const photo of onDisk) {
    const res = await db
      .insert(wakePhoto)
      .values({
        path: photo.path,
        capturedAt: new Date(photo.capturedAt),
        interactionSessionId: null,
        deviceId: null,
        frameIdx: null,
        bytes: photo.bytes,
      })
      .onConflictDoNothing();
    inserted += res.rowCount ?? 0;
  }
  return { inserted, scanned: onDisk.length };
}
```

Refactor the existing tree walk in `listWakePhotos` into a reusable `walkPhotoFiles(root): Promise<{ path: string; capturedAt: number; bytes: number }[]>` (flat, unsorted) — the walk logic already exists in `listWakePhotos`, move it wholesale rather than writing a second one. Then replace `listWakePhotos` with the SQL version:

```ts
/**
 * Day-grouped listing, newest first, read from the index.
 *
 * Returns the identical shape the tree walk did , the viewer and tile are
 * unchanged. `root` is still taken so tests can point at a temp dir, but is now
 * only used by the backfill path.
 */
export async function listWakePhotos(
  db: NodePgDatabase<typeof schema>,
  _root = defaultRoot(),
): Promise<WakePhotoListing> {
  const rows = await db
    .select()
    .from(wakePhoto)
    .orderBy(desc(wakePhoto.capturedAt));

  const byDay = new Map<string, WakePhotoDay>();
  let totalBytes = 0;
  for (const row of rows) {
    const day = row.capturedAt.toISOString().slice(0, 10);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = { day, photos: [] };
      byDay.set(day, bucket);
    }
    bucket.photos.push({ path: row.path, capturedAt: row.capturedAt.getTime() });
    totalBytes += row.bytes;
  }

  return { days: [...byDay.values()], totalCount: rows.length, totalBytes };
}
```

Add `desc` to the `drizzle-orm` import.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd products/control-center/api && bunx vitest run src/services/wake-photo-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Call the backfill at api boot and update the router**

In `products/control-center/api/src/trpc/routers/wake-photos.ts`, change the query to pass the db handle:

```ts
import { db } from "../../db/index";
...
    .query(() => listWakePhotos(db)),
```

In `products/control-center/api/src/db/migrate.ts` (or wherever `runMigrations()` is invoked at boot — read `server.ts` to confirm the call site), invoke the backfill immediately after migrations complete, logging its result:

```ts
const backfilled = await backfillWakePhotoIndex(db);
if (backfilled.inserted > 0) {
  getLogger().info(backfilled, "backfilled wake photo index");
}
```

- [ ] **Step 6: Verify, commit**

```bash
cd /Users/calum/code/github.com/0x63616c/world-wide-webb
bun run typecheck 2>&1 | grep -E "control-center"
cd products/control-center/api && bunx vitest run src/services
cd ../../.. && bunx biome check --write products/control-center/api/src
git add products/control-center
git commit -m "feat(control-center/api): backfill wake photo index and list from postgres"
git push --no-verify origin main
```

---

### Task 4: Wake-photo retention

Wake photos are the only media in this system with no retention — they accumulate forever, and there is no entry for them in `purge.ts` or `infra/src/crons.ts`. The index row from Task 2 is what finally makes a cheap cutoff possible.

**Files:**
- Create: `products/control-center/api/src/services/wake-photo-purge-service.ts`
- Modify: `products/control-center/api/src/purge.ts`
- Test: `products/control-center/api/src/services/wake-photo-purge-service.test.ts`

**Interfaces:**
- Consumes: `wakePhoto` table.
- Produces: `purgeWakePhotos(db, root?, now?): Promise<{ photos: number; truncated: boolean }>`, `WAKE_PHOTO_RETENTION_MS`.

- [ ] **Step 1: Write the failing test**

Create `products/control-center/api/src/services/wake-photo-purge-service.test.ts`. Mirror the setup of `frontend-log-purge-service.test.ts` (read it first), then:

```ts
  it("deletes rows and their files past the retention window, keeping recent ones", async () => {
    const now = new Date(Date.UTC(2026, 6, 18, 12, 0, 0));
    const old = Date.UTC(2026, 3, 1, 12, 0, 0); // >90 days before now
    const recent = Date.UTC(2026, 6, 17, 12, 0, 0);

    const oldPath = await saveWakePhoto(
      db,
      new Uint8Array([0xff, 0xd8, 0xff, 0x01]),
      { capturedAt: old, deviceId: null, sessionId: null, frameIdx: 0 },
      root,
    );
    const recentPath = await saveWakePhoto(
      db,
      new Uint8Array([0xff, 0xd8, 0xff, 0x02]),
      { capturedAt: recent, deviceId: null, sessionId: null, frameIdx: 0 },
      root,
    );

    const res = await purgeWakePhotos(db, root, now);
    expect(res.photos).toBe(1);

    expect(await readWakePhoto(oldPath, root)).toBeNull();
    expect(await readWakePhoto(recentPath, root)).not.toBeNull();
    const remaining = await db.select().from(wakePhoto);
    expect(remaining.map((r) => r.path)).toEqual([recentPath]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd products/control-center/api && bunx vitest run src/services/wake-photo-purge-service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the purge**

Create `products/control-center/api/src/services/wake-photo-purge-service.ts`:

```ts
/**
 * Wake-photo retention purge.
 *
 * Wake photos were the only media the control-center kept with no retention at
 * all , the filesystem tree was the store, and a tree has no cheap "older than"
 * query, so nothing ever deleted them. The index row (see wake-photo-service)
 * is what makes a cutoff affordable.
 *
 * Retention: KEEP 90 days, cut on `captured_at`. Longer than the 30-day frontend
 * log window on purpose , a photo is the only record of WHO was at the panel,
 * and it is far smaller per-event than the log lines it accompanies.
 *
 * Rows and files are deleted together, ROW FIRST: an orphaned file is invisible
 * (nothing lists from disk any more) and is reclaimed by the next backfill+purge
 * cycle, whereas an orphaned row 404s in the viewer.
 */
import { asc, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { getLogger } from "@www/logger";
import { wakePhoto } from "../db/schema";
import type * as schema from "../db/schema";
import { defaultWakePhotoRoot } from "./wake-photo-service";

/** Wake photos are retained for 90 days, then purged. */
export const WAKE_PHOTO_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Rows removed per batch. Each row is also a file unlink, so keep it modest. */
export const PURGE_BATCH_SIZE = 500;

/** Upper bound on batches per run, so one job can never run unbounded. */
export const MAX_BATCHES = 200;

export function wakePhotoCutoff(now: Date): Date {
  return new Date(now.getTime() - WAKE_PHOTO_RETENTION_MS);
}

export async function purgeWakePhotos(
  db: NodePgDatabase<typeof schema>,
  root = defaultWakePhotoRoot(),
  now: Date = new Date(),
): Promise<{ photos: number; truncated: boolean }> {
  const cutoff = wakePhotoCutoff(now);
  let deleted = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const doomed = await db
      .select({ path: wakePhoto.path })
      .from(wakePhoto)
      .where(lt(wakePhoto.capturedAt, cutoff))
      .orderBy(asc(wakePhoto.capturedAt))
      .limit(PURGE_BATCH_SIZE);
    if (doomed.length === 0) return { photos: deleted, truncated: false };

    for (const { path } of doomed) {
      await db.delete(wakePhoto).where(eq(wakePhoto.path, path));
      // A missing file is fine , the row is what the viewer reads, and this is
      // exactly the orphan case the row-first order deliberately allows.
      await unlink(join(root, path)).catch(() => {});
      deleted += 1;
    }
  }

  getLogger().info({ deleted }, "wake photo purge hit its batch cap");
  return { photos: deleted, truncated: true };
}
```

Export `defaultWakePhotoRoot` from `wake-photo-service.ts` by renaming its private `defaultRoot` and updating its internal callers. Add `eq` to the drizzle import.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd products/control-center/api && bunx vitest run src/services/wake-photo-purge-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Register it in the daily purge job**

In `products/control-center/api/src/purge.ts`, add the import and the call, extending the existing log line:

```ts
import { purgeWakePhotos } from "./services/wake-photo-purge-service";
...
  const wakePhotos = await purgeWakePhotos(db);
  log.info(
    { ...portal, ...weather, frontendLogs: frontendLogs.logs, wakePhotos: wakePhotos.photos },
    "data purge complete",
  );
  if (wakePhotos.truncated) {
    log.warn({}, "wake-photo purge hit its batch cap; a backlog remains for the next run");
  }
```

Also update the doc comment at the top of `purge.ts` to list wake photos alongside portal/weather/frontend logs.

- [ ] **Step 6: Verify, commit**

```bash
cd /Users/calum/code/github.com/0x63616c/world-wide-webb
bun run typecheck 2>&1 | grep -E "control-center"
cd products/control-center/api && bunx vitest run src/services
cd ../../.. && bunx biome check --write products/control-center/api/src
git add products/control-center
git commit -m "feat(control-center/api): add 90-day wake photo retention"
git push --no-verify origin main
```

---

### Task 5: The sessions query

A session is derived, not stored. `session/start` and `session/end` entries already carry the reason, event count and duration; aggregating them keeps one source of truth and inherits the log shipper's idempotent offline backfill for free.

**Files:**
- Create: `products/control-center/api/src/services/interaction-session-service.ts`
- Create: `products/control-center/api/src/trpc/routers/sessions.ts`
- Modify: `products/control-center/api/src/trpc/routers/index.ts`
- Test: `products/control-center/api/src/services/interaction-session-service.test.ts`

**Interfaces:**
- Consumes: `frontendLog`, `wakePhoto` tables.
- Produces:
  ```ts
  interface InteractionSessionSummary {
    id: string;
    startedAt: number;
    endedAt: number | null;   // null while a session is still live
    durationMs: number | null;
    eventCount: number;
    endReason: string | null;
    deviceName: string;
    photoPaths: string[];     // burst frames, chronological
  }
  interface InteractionSessionDetail extends InteractionSessionSummary {
    events: { ts: number; idx: number; msg: string; data: unknown }[];
  }
  listInteractionSessions(db, opts?: { limit?: number }): Promise<InteractionSessionSummary[]>
  getInteractionSession(db, id: string): Promise<InteractionSessionDetail | null>
  ```
- tRPC: `sessions.list({ limit? })`, `sessions.get({ id })`.

- [ ] **Step 1: Write the failing test**

Create `products/control-center/api/src/services/interaction-session-service.test.ts`. Seed `frontend_log` rows directly (copy the db setup from `frontend-log-service.test.ts`):

```ts
  it("summarises a session from its ui log entries, newest first", async () => {
    const sid = "isn_aaaaaaaaaaaa";
    await seedUiEntries(sid, [
      { ts: 1000, msg: "session/start", data: { interactionSessionId: sid, idx: 0 } },
      { ts: 2000, msg: "tile/tap", data: { interactionSessionId: sid, idx: 1, target: "tile_clock" } },
      {
        ts: 5000,
        msg: "session/end",
        data: { interactionSessionId: sid, idx: 2, reason: "idle-dim", events: 1, durationMs: 4000 },
      },
    ]);

    const [session] = await listInteractionSessions(db);
    expect(session).toMatchObject({
      id: sid,
      startedAt: 1000,
      endedAt: 5000,
      durationMs: 4000,
      endReason: "idle-dim",
      eventCount: 1,
    });
  });

  it("reports a live session as unended rather than inventing an end", async () => {
    const sid = "isn_bbbbbbbbbbbb";
    await seedUiEntries(sid, [
      { ts: 1000, msg: "session/start", data: { interactionSessionId: sid, idx: 0 } },
      { ts: 2000, msg: "tile/tap", data: { interactionSessionId: sid, idx: 1, target: "tile_clock" } },
    ]);

    const [session] = await listInteractionSessions(db);
    expect(session.endedAt).toBeNull();
    expect(session.durationMs).toBeNull();
    expect(session.endReason).toBeNull();
  });

  it("attaches the burst frames captured for that session, chronologically", async () => {
    const sid = "isn_cccccccccccc";
    await seedUiEntries(sid, [
      { ts: 1000, msg: "session/start", data: { interactionSessionId: sid, idx: 0 } },
    ]);
    await db.insert(wakePhoto).values([
      { path: "2026/07/18/2000-1.jpg", capturedAt: new Date(2000), interactionSessionId: sid, bytes: 10, frameIdx: 1 },
      { path: "2026/07/18/1000-0.jpg", capturedAt: new Date(1000), interactionSessionId: sid, bytes: 10, frameIdx: 0 },
    ]);

    const [session] = await listInteractionSessions(db);
    expect(session.photoPaths).toEqual(["2026/07/18/1000-0.jpg", "2026/07/18/2000-1.jpg"]);
  });

  it("returns the full ordered transcript for one session", async () => {
    const sid = "isn_dddddddddddd";
    await seedUiEntries(sid, [
      { ts: 1000, msg: "session/start", data: { interactionSessionId: sid, idx: 0 } },
      { ts: 3000, msg: "modal/open", data: { interactionSessionId: sid, idx: 2, target: "modal.Climate" } },
      { ts: 2000, msg: "tile/tap", data: { interactionSessionId: sid, idx: 1, target: "tile_climate" } },
    ]);

    const detail = await getInteractionSession(db, sid);
    expect(detail?.events.map((e) => e.msg)).toEqual(["session/start", "tile/tap", "modal/open"]);
  });

  it("returns null for an unknown session", async () => {
    expect(await getInteractionSession(db, "isn_zzzzzzzzzzzz")).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd products/control-center/api && bunx vitest run src/services/interaction-session-service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `products/control-center/api/src/services/interaction-session-service.ts`:

```ts
/**
 * Interaction sessions , a visit to the wall panel, reconstructed.
 *
 * DERIVED, NOT STORED. There is deliberately no `interaction_session` table:
 * the `session/start` and `session/end` entries the panel already ships carry
 * every attribute a session has (reason, event count, duration), and the log
 * shipper is idempotent and backfills offline windows. A second write path for
 * session rows would be a copy that can drift from, and lose rows relative to,
 * the log it copies. An aggregate cannot drift.
 *
 * The cost is that a session is a GROUP BY rather than a row, which is why the
 * ui-channel entries carry `interactionSessionId` in their JSONB payload and the
 * frontend_log ts index does the heavy lifting.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { frontendLog, wakePhoto } from "../db/schema";
import type * as schema from "../db/schema";

export interface InteractionSessionSummary {
  id: string;
  startedAt: number;
  /** Null while the visit is still in progress (no session/end shipped yet). */
  endedAt: number | null;
  durationMs: number | null;
  eventCount: number;
  endReason: string | null;
  deviceName: string;
  /** Burst frame paths, chronological. Empty when the burst failed or dimming is off. */
  photoPaths: string[];
}

export interface InteractionSessionEvent {
  ts: number;
  idx: number;
  msg: string;
  data: unknown;
}

export interface InteractionSessionDetail extends InteractionSessionSummary {
  events: InteractionSessionEvent[];
}

const DEFAULT_LIMIT = 50;

/** The ui-channel rows for one session, in transcript order. */
async function eventsFor(
  db: NodePgDatabase<typeof schema>,
  id: string,
): Promise<InteractionSessionEvent[]> {
  const rows = await db
    .select({ ts: frontendLog.ts, msg: frontendLog.msg, data: frontendLog.data })
    .from(frontendLog)
    .where(
      and(eq(frontendLog.source, "ui"), sql`${frontendLog.data}->>'interactionSessionId' = ${id}`),
    )
    .orderBy(asc(frontendLog.ts));

  return rows.map((r) => ({
    ts: r.ts.getTime(),
    idx: Number((r.data as { idx?: number } | null)?.idx ?? 0),
    msg: r.msg,
    data: r.data,
  }));
}

/** Fold a session's ordered events + photos into its summary. */
function summarise(
  id: string,
  events: InteractionSessionEvent[],
  deviceName: string,
  photoPaths: string[],
): InteractionSessionSummary {
  const end = events.find((e) => e.msg === "session/end");
  const endData = end?.data as { reason?: string; events?: number; durationMs?: number } | undefined;
  return {
    id,
    startedAt: events[0]?.ts ?? 0,
    endedAt: end?.ts ?? null,
    durationMs: endData?.durationMs ?? null,
    // Prefer the count the panel itself recorded; fall back to what shipped, so
    // a live (unended) session still reports a truthful number.
    eventCount:
      endData?.events ??
      events.filter((e) => e.msg !== "session/start" && e.msg !== "session/end").length,
    endReason: endData?.reason ?? null,
    deviceName,
    photoPaths,
  };
}

export async function listInteractionSessions(
  db: NodePgDatabase<typeof schema>,
  opts: { limit?: number } = {},
): Promise<InteractionSessionSummary[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // One row per session: its id, bounds and device, newest visit first.
  const groups = await db
    .select({
      id: sql<string>`${frontendLog.data}->>'interactionSessionId'`.as("id"),
      startedAt: sql<Date>`min(${frontendLog.ts})`.as("started_at"),
      deviceName: sql<string>`max(${frontendLog.deviceName})`.as("device_name"),
    })
    .from(frontendLog)
    .where(
      and(eq(frontendLog.source, "ui"), sql`${frontendLog.data}->>'interactionSessionId' is not null`),
    )
    .groupBy(sql`${frontendLog.data}->>'interactionSessionId'`)
    .orderBy(desc(sql`min(${frontendLog.ts})`))
    .limit(limit);

  const summaries: InteractionSessionSummary[] = [];
  for (const g of groups) {
    const events = await eventsFor(db, g.id);
    const photos = await db
      .select({ path: wakePhoto.path })
      .from(wakePhoto)
      .where(eq(wakePhoto.interactionSessionId, g.id))
      .orderBy(asc(wakePhoto.capturedAt));
    summaries.push(
      summarise(
        g.id,
        events,
        g.deviceName,
        photos.map((p) => p.path),
      ),
    );
  }
  return summaries;
}

export async function getInteractionSession(
  db: NodePgDatabase<typeof schema>,
  id: string,
): Promise<InteractionSessionDetail | null> {
  const events = await eventsFor(db, id);
  if (events.length === 0) return null;

  const photos = await db
    .select({ path: wakePhoto.path })
    .from(wakePhoto)
    .where(eq(wakePhoto.interactionSessionId, id))
    .orderBy(asc(wakePhoto.capturedAt));

  const [row] = await db
    .select({ deviceName: frontendLog.deviceName })
    .from(frontendLog)
    .where(
      and(eq(frontendLog.source, "ui"), sql`${frontendLog.data}->>'interactionSessionId' = ${id}`),
    )
    .limit(1);

  return {
    ...summarise(
      id,
      events,
      row?.deviceName ?? "unknown",
      photos.map((p) => p.path),
    ),
    events,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd products/control-center/api && bunx vitest run src/services/interaction-session-service.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Expose it over tRPC**

Create `products/control-center/api/src/trpc/routers/sessions.ts`:

```ts
import { z } from "zod";
import { db } from "../../db/index";
import {
  getInteractionSession,
  listInteractionSessions,
} from "../../services/interaction-session-service";
import { publicProcedure, router } from "../init";

const SummarySchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  eventCount: z.number(),
  endReason: z.string().nullable(),
  deviceName: z.string(),
  photoPaths: z.array(z.string()),
});

const DetailSchema = SummarySchema.extend({
  events: z.array(
    z.object({ ts: z.number(), idx: z.number(), msg: z.string(), data: z.unknown() }),
  ),
});

export const sessionsRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .output(z.array(SummarySchema))
    .query(({ input }) => listInteractionSessions(db, { limit: input?.limit })),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(DetailSchema.nullable())
    .query(({ input }) => getInteractionSession(db, input.id)),
});
```

Register it in `products/control-center/api/src/trpc/routers/index.ts` alongside `wakePhotos`: add `import { sessionsRouter } from "./sessions";` and `sessions: sessionsRouter,` to the `appRouter` object.

- [ ] **Step 6: Verify, commit**

```bash
cd /Users/calum/code/github.com/0x63616c/world-wide-webb
bun run typecheck 2>&1 | grep -E "control-center"
cd products/control-center/api && bunx vitest run src/services src/trpc
cd ../../.. && bunx biome check --write products/control-center/api/src
git add products/control-center
git commit -m "feat(control-center/api): derive interaction sessions from the ui log"
git push --no-verify origin main
```

---

### Task 6: The Sessions view

Add a sessions mode to the existing wake-photo viewer rather than a new tile. The Wakes tile is already the "who was at the panel" affordance and `WakePhotoViewer` already has a `Segmented` mode switcher (Grid / Timelapse) — Sessions is a third mode over the same subject, and a second tile competing for board space would split one idea across two places.

**Files:**
- Create: `products/control-center/web/src/components/tiles/SessionListView.tsx`
- Create: `products/control-center/web/src/components/tiles/SessionListView.stories.tsx`
- Create: `products/control-center/web/src/components/tiles/SessionDetailView.tsx`
- Create: `products/control-center/web/src/components/tiles/SessionDetailView.stories.tsx`
- Modify: `products/control-center/web/src/components/tiles/WakePhotoViewer.tsx`
- Modify: `products/control-center/web/src/components/tiles/WakesTile.tsx`
- Test: `products/control-center/web/src/components/__tests__/SessionListView.stories.test.tsx`

**Interfaces:**
- Consumes: `trpc.sessions.list`, `trpc.sessions.get` from Task 5.
- Produces:
  ```ts
  // Mirrors InteractionSessionSummary from Task 5 exactly , including
  // deviceName, which the list renders when more than one device has sessions.
  interface SessionSummary {
    id: string; startedAt: number; endedAt: number | null; durationMs: number | null;
    eventCount: number; endReason: string | null; deviceName: string; photoPaths: string[];
  }
  type SessionDetail = SessionSummary & {
    events: { ts: number; idx: number; msg: string; data: unknown }[];
  };
  SessionListView(props: {
    sessions: SessionSummary[];
    photoUrl: (path: string) => string;
    onSelect: (id: string) => void;
  })
  SessionDetailView(props: {
    session: SessionDetail;
    photoUrl: (path: string) => string;
    onBack: () => void;
  })
  ```

- [ ] **Step 1: Write SessionListView**

Create `products/control-center/web/src/components/tiles/SessionListView.tsx`. Pure presentational — data via props, no hooks beyond local formatting. Each row: the first burst frame as a thumbnail (or a neutral placeholder block when `photoPaths` is empty — an unattributed or backfilled session is a real state, not an error), the start time, duration, event count, and a one-line summary of what was touched, derived from the events the summary carries. Use `Modal`-compatible styling from `@/components/ui`; no new colors — reuse existing CSS custom properties (`--ink-1`, `--ink-3`, etc.) as `WakePhotoViewer` does.

Duration formatting: `null` renders as "live", otherwise `Xm Ys` (drop the minutes segment below 60s).

- [ ] **Step 2: Write its story**

Create `SessionListView.stories.tsx` with `tags: ["autodocs"]` (required by the `storybook-docs` guard). Stories: `Default` (three sessions, varied durations), `Live` (newest session with `endedAt: null`), `NoPhotos` (a backfilled session with `photoPaths: []`), `Empty` (no sessions at all). Use real-shaped data — no lorem, no fake device names beyond what the panel actually produces.

- [ ] **Step 3: Write the story test**

Create `products/control-center/web/src/components/__tests__/SessionListView.stories.test.tsx` following the pattern of a sibling `*.stories.test.tsx` (read `PlaceholderTile.stories.test.tsx` first — copy its composeStories harness verbatim). Assert: the `Default` story renders one row per session; `Empty` renders an empty-state message and no rows; `Live` renders "live" rather than a duration.

- [ ] **Step 4: Run the story test**

```bash
cd products/control-center/web && bunx vitest run src/components/__tests__/SessionListView.stories.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write SessionDetailView + its story**

Create `SessionDetailView.tsx`: burst frames across the top (reuse the grid styling already in `WakePhotoViewer`), then the transcript as a table — time, `msg`, and the `target` pulled from `data`. Order by `idx`, falling back to `ts`. A `onBack` control returns to the list.

Create `SessionDetailView.stories.tsx` with `tags: ["autodocs"]`: `Default` (photos + a ~6-event transcript), `NoPhotos`, `SingleEvent`.

- [ ] **Step 6: Wire the mode into WakePhotoViewer**

In `WakePhotoViewer.tsx`, extend the mode union and options:

```tsx
type ViewerMode = "grid" | "lapse" | "sessions";

const MODE_OPTIONS: readonly SegmentedOption<ViewerMode>[] = [
  { value: "grid", label: "Grid" },
  { value: "lapse", label: "Timelapse" },
  { value: "sessions", label: "Sessions" },
];
```

Add props `sessions: SessionSummary[]`, `selectedSession: SessionDetail | null`, `onSelectSession: (id: string | null) => void`, and render `SessionDetailView` when a session is selected, otherwise `SessionListView`, whenever `mode === "sessions"`. Keep the component presentational — the query lives in `WakesTile`.

- [ ] **Step 7: Wire the queries in WakesTile**

In `WakesTile.tsx`, add:

```tsx
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const sessions = trpc.sessions.list.useQuery(undefined, { refetchInterval: 60_000 });
  const detail = trpc.sessions.get.useQuery(
    { id: selectedSessionId ?? "" },
    { enabled: selectedSessionId !== null },
  );
```

Pass `sessions={sessions.data ?? []}`, `selectedSession={detail.data ?? null}`, `onSelectSession={setSelectedSessionId}` into `WakePhotoViewer`. Reset `selectedSessionId` to `null` when the viewer closes so a reopen starts at the list.

- [ ] **Step 8: Run the full web suite**

```bash
cd products/control-center/web && bunx vitest run --testTimeout=20000
```

Expected: PASS across all files.

- [ ] **Step 9: Verify in the real app**

Use the `verify` skill, or drive it manually: run `bun run dev`, open the panel, let it dim, tap to wake, tap a few tiles, then open the Wakes tile → Sessions. Confirm the visit you just performed appears as one session with its burst frames and your taps in order. A passing test suite is not evidence this works end to end.

- [ ] **Step 10: Lint, typecheck, commit**

```bash
cd /Users/calum/code/github.com/0x63616c/world-wide-webb
bun run typecheck 2>&1 | grep -E "control-center"
bunx biome check --write products/control-center/web/src
git add products/control-center
git commit -m "feat(control-center/web): add a sessions view to the wake photo viewer"
git push --no-verify origin main
```

---

### Task 7: Update the design doc

**Files:**
- Modify: `docs/specs/2026-07-18-interaction-logging-design.md`

- [ ] **Step 1: Record what changed**

Update the doc to reflect reality after this plan:
- Status line: tiers A+B shipped, sessions correlated with wake photos, tiers C–D and the §4.1–4.3 guards still outstanding.
- §3.2: the session boundary is now the undim event, with the 60s timeout demoted to a fallback for non-dimming environments. State the known hole: a person arriving while the panel is already awake joins the previous session.
- New section: the `wake_photo` table, why sessions are derived rather than stored, and the 90-day photo retention.
- §7: strike the resolved questions (device-origin, viewer) and record the answers.

- [ ] **Step 2: Commit**

```bash
git add docs/specs/2026-07-18-interaction-logging-design.md
git commit -m "docs: record wake-photo session correlation"
git push --no-verify origin main
```

---

## Deferred (not in this plan)

Tracked so they are not silently lost:

- **Tier C** — required `logId` prop on `ControlTap` / `Switch` / `Slider` / `Segmented`, logging inside the primitive. The typecheck-enforced "can't forget" mechanism.
- **Tier D** — pan/scroll gestures logged on settle, never per-frame.
- **§4.2 guard** — `scripts/check-interaction-logging.sh` banning raw handlers outside `components/ui/`.
- **§4.3 guard** — `logId` uniqueness assertion in `registry-guards.test.ts`.
- **The already-awake hole** — a second person arriving without an undim joins the previous session. Needs a presence signal (HA motion) to fix properly.
