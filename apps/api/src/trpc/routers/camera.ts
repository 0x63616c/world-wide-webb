import { z } from "zod";
import { getCameraInfo } from "../../services/camera-service";
import { publicProcedure, router } from "../init";

const CameraInfoSchema = z
  .object({
    label: z.string(),
    online: z.boolean(),
    snapshotUrl: z.string().nullable(),
    streamUrl: z.string().nullable(),
    entityId: z.string().nullable(),
  })
  .nullable();

export const cameraRouter = router({
  info: publicProcedure
    .input(z.object({}).optional())
    .output(CameraInfoSchema)
    .query(() => getCameraInfo()),
});
