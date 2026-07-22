import { z } from "zod";
import { db } from "../../db/index";
import { listWakePhotos } from "../../services/wake-photo-service";
import { publicProcedure, router } from "../init";

const WakePhotoListingSchema = z.object({
  days: z.array(
    z.object({
      day: z.string(),
      photos: z.array(
        z.object({
          path: z.string(),
          capturedAt: z.number(),
          interactionSessionId: z.string().nullable(),
        }),
      ),
    }),
  ),
  totalCount: z.number(),
  totalBytes: z.number(),
});

export const wakePhotosRouter = router({
  list: publicProcedure
    .input(z.object({}).optional())
    .output(WakePhotoListingSchema)
    .query(() => listWakePhotos(db)),
});
