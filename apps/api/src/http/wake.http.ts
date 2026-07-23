import { defineHttp } from "@app-kit";
import { db } from "../db/index";
import { saveWakePhoto } from "../services/wake-photo-service";

/**
 * Wake-photo ingest (S3 transitional home, see scripts/apps-gen/collect.ts's
 * INTERIM_HTTP_MODULES comment). Moved VERBATIM from server.ts's old
 * `/media/wake-photo` branch , same raw-body handling, same attribution-header
 * shape validation, same 201/400 split. CORS is no longer set here; the S3
 * route-table iterator overlays it centrally (see server.ts).
 *
 * The panel POSTs each burst frame as a raw JPEG body. Validation (JPEG magic,
 * size cap) lives in the service; any rejection is a 400 so a misbehaving
 * client can't 500-spam the log.
 *
 * The attribution headers are UNAUTHENTICATED (as is this whole route , the
 * panel talks same-origin inside the homelab perimeter, there is no client
 * auth to check). Shape-validate them so arbitrary header bytes can never land
 * in wake_photo: a malformed value stores as NULL (unattributed), the same
 * honest state a headerless upload gets.
 */
export const routes = defineHttp([
  {
    method: "POST",
    path: "/media/wake-photo",
    match: "exact",
    handler: async (req) => {
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
        return Response.json({ path }, { status: 201 });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : "invalid wake photo", {
          status: 400,
        });
      }
    },
  },
]);
