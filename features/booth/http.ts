import { defineHttp } from "@app-kit";
import { db } from "./db";
import {
  BOOTH_FILTER_PATTERN,
  BOOTH_PHOTO_MODES,
  type BoothPhotoMode,
  newBoothGroupId,
  saveBoothPhoto,
} from "./service";

/**
 * Photo-booth ingest (Track C, final tile fold, moved out of the interim
 * apps/api/src/http/booth.http.ts into this feature's own http.ts, collected by
 * scripts/apps-gen/collect.ts's Source A rather than the INTERIM_HTTP_MODULES
 * list). Same raw-body handling, same mode/filter/group validation, same
 * 201/400 split. CORS is not set here; the route-table iterator overlays it
 * centrally (see server.ts).
 *
 * The panel POSTs each captured frame as a raw image body (JPEG for
 * photo/burst/four_frame, GIF for gif). Validation (format magic vs. mode,
 * size cap) lives in the service; any rejection is a 400 so a misbehaving
 * client can't 500-spam the log.
 *
 * Like the wake-photo route this is UNAUTHENTICATED same-origin ingest. The
 * attribution headers are shape-validated so arbitrary bytes can never land in
 * booth_photo: a bad mode 400s, a missing/malformed group id starts a fresh
 * group (a single-frame capture), a malformed device id stores as NULL. The
 * optional x-filter (a non-destructive display id) is absent for an unfiltered
 * shot or a gif (baked in client-side), but a PRESENT malformed value 400s
 * rather than storing junk.
 */
export const routes = defineHttp([
  {
    method: "POST",
    path: "/media/booth-photo",
    match: "exact",
    handler: async (req) => {
      const rawMode = req.headers.get("x-mode");
      if (!rawMode || !BOOTH_PHOTO_MODES.includes(rawMode as BoothPhotoMode)) {
        return new Response(`invalid mode: ${rawMode ?? "<missing>"}`, { status: 400 });
      }
      const mode = rawMode as BoothPhotoMode;
      const rawFilter = req.headers.get("x-filter");
      if (rawFilter !== null && !BOOTH_FILTER_PATTERN.test(rawFilter)) {
        return new Response(`invalid filter: ${rawFilter}`, { status: 400 });
      }
      const filter = rawFilter;
      const headerTs = Number(req.headers.get("x-captured-at"));
      const capturedAt = Number.isFinite(headerTs) && headerTs > 0 ? headerTs : Date.now();
      const frameHeader = Number(req.headers.get("x-frame-idx"));
      const frameIdx = Number.isFinite(frameHeader) && frameHeader >= 0 ? frameHeader : 0;
      const rawGroup = req.headers.get("x-group-id");
      const groupId =
        rawGroup && /^bpg_[0-9a-z]{1,32}$/.test(rawGroup) ? rawGroup : newBoothGroupId();
      const rawDevice = req.headers.get("x-device-id");
      const deviceId = rawDevice && /^[0-9A-Za-z_-]{1,64}$/.test(rawDevice) ? rawDevice : null;
      // A gif's raw source frames upload with x-source-only: 1 so they are
      // stored but kept out of the gallery. Any other value (or absent) means
      // a normal, shown frame.
      const sourceOnly = req.headers.get("x-source-only") === "1";
      const bytes = new Uint8Array(await req.arrayBuffer());
      try {
        const saved = await saveBoothPhoto(db, bytes, {
          capturedAt,
          mode,
          groupId,
          frameIdx,
          deviceId,
          filter,
          sourceOnly,
        });
        return Response.json(saved, { status: 201 });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : "invalid booth photo", {
          status: 400,
        });
      }
    },
  },
]);
