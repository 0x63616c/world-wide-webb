/**
 * tRPC `camera` facet (Track C, Wave 2). The Living Room Cam tile's info
 * surface. Reaches the tRPC runtime ONLY through @app-kit/server and HA ONLY
 * through the feature's own service — never apps/api. Codegen collects the
 * top-level key `camera` off `api._def.record`.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { getCameraInfo } from "./service";

const CameraInfoSchema = z
  .object({
    label: z.string(),
    online: z.boolean(),
    snapshotUrl: z.string().nullable(),
    streamUrl: z.string().nullable(),
    entityId: z.string().nullable(),
  })
  .nullable();

const cameraRouter = router({
  info: publicProcedure
    .input(z.object({}).optional())
    .output(CameraInfoSchema)
    .query(() => getCameraInfo()),
});

/** The branded `api` facet, single top-level key `camera`. */
export const api = defineApi(router({ camera: cameraRouter }));
