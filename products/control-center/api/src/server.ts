import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createLogger } from "@www/logger";
import { db } from "./db/index";
import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { getTvArtwork } from "./services/apple-tv-service";
import {
  BOOTH_PHOTO_MODES,
  type BoothPhotoMode,
  newBoothGroupId,
  readBoothPhoto,
  saveBoothPhoto,
} from "./services/booth-photo-service";
import { openCameraStream } from "./services/camera-service";
import { getClimate } from "./services/climate-service";
import {
  backfillWakePhotoIndex,
  readWakePhoto,
  saveWakePhoto,
} from "./services/wake-photo-service";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/routers/index";

// Root logger, created ONCE at process startup, bound to every line in this
// process. Domain services use getLogger() (see docs/logging.md §2).
const log = createLogger({ service: "api" });

// Deploys reach this box automatically: push to main -> CI builds the image ->
// the cluster rolls the service to the new digest (www-a8p).
//
// Apply pending SQL migrations before accepting traffic. Uses drizzle-orm's
// runtime migrator (not drizzle-kit), so the production image ships no build
// toolchain. runMigrations() logs start/done internally; we only need to
// surface the error here (it rethrows, so Swarm crash-backoff retries until
// postgres is reachable and migrated).
try {
  await runMigrations();
} catch (err) {
  log.error({ err }, "migrations failed");
  throw err;
}

// Index any wake photos that predate the wake_photo table (or that a failed
// row insert left unindexed). Idempotent, so running on every boot is the
// cheapest way to guarantee the index converges on the filesystem's truth.
try {
  const backfilled = await backfillWakePhotoIndex(db);
  if (backfilled.inserted > 0) {
    log.info(backfilled, "backfilled wake photo index");
  }
} catch (err) {
  // Non-fatal: the api can serve without a complete photo index; the next
  // boot retries.
  log.error({ err }, "wake photo backfill failed");
}

// CORS for the Vite dev server (web on :4200). In production the api serves the
// built web bundle from the same origin, so these are dev conveniences.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Routes a single request. Wrapped by fetch() below, which logs every call.
async function handle(req: Request, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === "/up") {
    return new Response("OK", { status: 200, headers: CORS_HEADERS });
  }

  // Deploy-health probe target (www-hya3). The deploy `verify` step curls this to
  // prove the api can reach live Home Assistant, decoupled from the tRPC wire format so
  // a procedure rename can't silently turn the probe advisory-red (which is how
  // the old /api/climate.now probe rotted). getClimate() throws on an HA outage
  // or misconfig (services-throw convention), surfacing as a 500 -> red probe.
  if (url.pathname === "/health/climate") {
    const { ambient } = await getClimate();
    return Response.json({ ambient }, { status: 200, headers: CORS_HEADERS });
  }

  // Now-playing artwork proxy (www-dhhr). The panel can't reach HA and the
  // entity_picture URL embeds an HA token, so the api streams the bytes.
  if (url.pathname === "/media/tv-artwork") {
    const artwork = await getTvArtwork();
    if (!artwork) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    return new Response(artwork.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": artwork.headers.get("content-type") ?? "application/octet-stream",
        // The ?v= param busts on artwork change, so short caching is safe.
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  // Live camera MJPEG proxy. go2rtc holds the RTSP credentials and transcodes
  // the bedroom stream to MJPEG; the panel just consumes this same-origin path
  // in an <img>. The body is a long-lived multipart stream, so it is piped
  // through verbatim and MUST NOT be cached (a max-age here would freeze the
  // feed on the first frame) and MUST NOT carry any request timeout.
  if (url.pathname === "/media/camera-stream") {
    const upstream = await openCameraStream();
    if (!upstream) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type":
          upstream.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-store",
      },
    });
  }

  // Wake-photo ingest: the panel POSTs each burst frame as a raw JPEG body.
  // Validation (JPEG magic, size cap) lives in the service; any rejection is a
  // 400 so a misbehaving client can't 500-spam the log.
  //
  // The attribution headers are UNAUTHENTICATED (as is this whole route , the
  // panel talks same-origin inside the homelab perimeter, there is no client
  // auth to check). Shape-validate them so arbitrary header bytes can never
  // land in wake_photo: a malformed value stores as NULL (unattributed), the
  // same honest state a headerless upload gets.
  if (url.pathname === "/media/wake-photo" && req.method === "POST") {
    const headerTs = Number(req.headers.get("x-captured-at"));
    const capturedAt = Number.isFinite(headerTs) && headerTs > 0 ? headerTs : Date.now();
    const frameHeader = Number(req.headers.get("x-frame-idx"));
    const frameIdx = Number.isFinite(frameHeader) && frameHeader >= 0 ? frameHeader : 0;
    const rawSession = req.headers.get("x-session-id");
    const sessionId = rawSession && /^isn_[0-9a-z]{1,32}$/.test(rawSession) ? rawSession : null;
    const rawDevice = req.headers.get("x-device-id");
    const deviceId = rawDevice && /^[0-9A-Za-z_-]{1,64}$/.test(rawDevice) ? rawDevice : null;
    const bytes = new Uint8Array(await req.arrayBuffer());
    try {
      const path = await saveWakePhoto(db, bytes, {
        capturedAt,
        frameIdx,
        deviceId,
        sessionId,
      });
      return Response.json({ path }, { status: 201, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "invalid wake photo", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
  }

  // Wake-photo bytes for the viewer. Stored files never change, so the
  // content is immutable-cacheable; traversal/missing both 404 via the
  // service's null.
  if (url.pathname.startsWith("/media/wake-photos/")) {
    const rel = decodeURIComponent(url.pathname.slice("/media/wake-photos/".length));
    const photo = await readWakePhoto(rel);
    if (!photo) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    return new Response(photo.bytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // Photo-booth ingest: the panel POSTs each captured frame as a raw image body
  // (JPEG for photo/burst/four_frame, GIF for gif). Validation (format magic vs.
  // mode, size cap) lives in the service; any rejection is a 400 so a
  // misbehaving client can't 500-spam the log.
  //
  // Like the wake-photo route this is UNAUTHENTICATED same-origin ingest. The
  // attribution headers are shape-validated so arbitrary bytes can never land in
  // booth_photo: a bad mode 400s, a missing/malformed group id starts a fresh
  // group (a single-frame capture), a malformed device id stores as NULL.
  if (url.pathname === "/media/booth-photo" && req.method === "POST") {
    const rawMode = req.headers.get("x-mode");
    if (!rawMode || !BOOTH_PHOTO_MODES.includes(rawMode as BoothPhotoMode)) {
      return new Response(`invalid mode: ${rawMode ?? "<missing>"}`, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    const mode = rawMode as BoothPhotoMode;
    const headerTs = Number(req.headers.get("x-captured-at"));
    const capturedAt = Number.isFinite(headerTs) && headerTs > 0 ? headerTs : Date.now();
    const frameHeader = Number(req.headers.get("x-frame-idx"));
    const frameIdx = Number.isFinite(frameHeader) && frameHeader >= 0 ? frameHeader : 0;
    const rawGroup = req.headers.get("x-group-id");
    const groupId =
      rawGroup && /^bpg_[0-9a-z]{1,32}$/.test(rawGroup) ? rawGroup : newBoothGroupId();
    const rawDevice = req.headers.get("x-device-id");
    const deviceId = rawDevice && /^[0-9A-Za-z_-]{1,64}$/.test(rawDevice) ? rawDevice : null;
    const bytes = new Uint8Array(await req.arrayBuffer());
    try {
      const saved = await saveBoothPhoto(db, bytes, {
        capturedAt,
        mode,
        groupId,
        frameIdx,
        deviceId,
      });
      return Response.json(saved, { status: 201, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "invalid booth photo", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
  }

  // Photo-booth bytes for the gallery. Stored files never change, so the content
  // is immutable-cacheable; traversal/missing both 404 via the service's null.
  // Content-Type follows the extension (GIF animations vs. JPEG stills).
  if (url.pathname.startsWith("/media/booth-photos/")) {
    const rel = decodeURIComponent(url.pathname.slice("/media/booth-photos/".length));
    const photo = await readBoothPhoto(rel);
    if (!photo) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    return new Response(photo.bytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": rel.endsWith(".gif") ? "image/gif" : "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (url.pathname.startsWith("/trpc")) {
    const res = await fetchRequestHandler({
      endpoint: "/trpc",
      req,
      router: appRouter,
      createContext: () => createContext(),
      onError: ({ path, error, req: errorReq }) => {
        // Build the child logger inline, path is available here but reqId comes
        // from the outer fetch scope, so we log with path + code directly.
        const reqUrl = new URL(errorReq.url);
        const reqLog = log.child({ method: errorReq.method, path: reqUrl.pathname });
        reqLog.error({ err: error, trpcPath: path ?? "<unknown>" }, "trpc error");
      },
    });
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
}

const server = Bun.serve({
  port: env.PORT,
  async fetch(req) {
    const url = new URL(req.url);
    // Single chokepoint: every network request (OPTIONS, /up, /trpc, 404)
    // routes through handle(), so logging here captures all of them with
    // method, path, status, and wall-clock duration.
    const startedAt = performance.now();
    // Bind a per-request child logger with a unique request id so every log
    // line for this request carries the same correlation fields.
    const reqId = `req_${Math.random().toString(36).slice(2, 10)}`;
    const reqLog = log.child({ reqId, method: req.method, path: url.pathname });

    let res: Response;
    try {
      res = await handle(req, url);
    } catch (err) {
      const durationMs = +(performance.now() - startedAt).toFixed(1);
      reqLog.error({ err, status: 500, durationMs }, "request failed");
      throw err;
    }

    const durationMs = +(performance.now() - startedAt).toFixed(1);
    // OPTIONS preflights are transport noise, log at debug so they don't
    // double the info line count in steady state (docs/logging.md §6).
    if (req.method === "OPTIONS") {
      reqLog.debug({ status: res.status, durationMs }, "request completed");
    } else {
      reqLog.info({ status: res.status, durationMs }, "request completed");
    }
    return res;
  },
});

// Startup liveness line (docs/logging.md §6): "api started" with port + env
// is the operator's first grep after a deploy.
log.info({ port: server.port, env: env.NODE_ENV }, "api started");

// The api is request-only (www-7d5b.1.2). The device-sync and weather-ingest
// loops now run in the dedicated worker process (src/worker.ts), so the api no
// longer starts them in-process.
