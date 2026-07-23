/**
 * tRPC `boothPhotos` facet (Track C, final tile fold), folded from
 * apps/api/src/trpc/routers/booth-photos.ts. The feature reaches the tRPC
 * runtime ONLY through `@app-kit/server` (the single sanctioned seam into
 * apps/api's trpc/init, never a direct apps/api import); its query bodies live
 * in ./service against this feature's own db.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { db } from "./db";
import {
  BOOTH_PHOTO_MODES,
  clearBoothGroupFilter,
  listBoothPhotos,
  softDeleteBoothGroup,
} from "./service";

const BoothPhotoFrameSchema = z.object({
  id: z.string(),
  path: z.string(),
  capturedAt: z.number(),
  frameIdx: z.number(),
  mimeType: z.string(),
  filter: z.string().nullable(),
});

const BoothPhotoListingSchema = z.object({
  groups: z.array(
    z.object({
      groupId: z.string(),
      mode: z.enum(BOOTH_PHOTO_MODES),
      capturedAt: z.number(),
      filter: z.string().nullable(),
      frames: z.array(BoothPhotoFrameSchema),
    }),
  ),
  totalCount: z.number(),
  totalBytes: z.number(),
});

const boothPhotosRouter = router({
  // The gallery read: live captures grouped, newest first.
  list: publicProcedure
    .input(z.object({}).optional())
    .output(BoothPhotoListingSchema)
    .query(() => listBoothPhotos(db)),

  // Remove a whole capture from the gallery. Reversible under the hood (the
  // bytes stay on disk), so nothing here says "delete" to the user.
  remove: publicProcedure
    .input(z.object({ groupId: z.string() }))
    .output(z.object({ removed: z.number() }))
    .mutation(({ input }) => softDeleteBoothGroup(db, input.groupId)),

  // Non-destructively drop a capture's filter, returning it to its bare look.
  // The stored bytes were always unfiltered, so there is nothing to re-render.
  clearFilter: publicProcedure
    .input(z.object({ groupId: z.string() }))
    .output(z.object({ cleared: z.number() }))
    .mutation(({ input }) => clearBoothGroupFilter(db, input.groupId)),
});

/**
 * The branded `api` facet. Its one top-level key, `boothPhotos`, is the router
 * namespace the generated app router mounts. The codegen reads these keys off
 * `api._def.record`.
 */
export const api = defineApi(router({ boothPhotos: boothPhotosRouter }));
