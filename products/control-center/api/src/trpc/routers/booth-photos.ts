import { z } from "zod";
import { db } from "../../db/index";
import {
  BOOTH_PHOTO_MODES,
  listBoothPhotos,
  softDeleteBoothGroup,
} from "../../services/booth-photo-service";
import { publicProcedure, router } from "../init";

const BoothPhotoFrameSchema = z.object({
  id: z.string(),
  path: z.string(),
  capturedAt: z.number(),
  frameIdx: z.number(),
  mimeType: z.string(),
});

const BoothPhotoListingSchema = z.object({
  groups: z.array(
    z.object({
      groupId: z.string(),
      mode: z.enum(BOOTH_PHOTO_MODES),
      capturedAt: z.number(),
      frames: z.array(BoothPhotoFrameSchema),
    }),
  ),
  totalCount: z.number(),
  totalBytes: z.number(),
});

export const boothPhotosRouter = router({
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
});
