import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { cameraSchema } from "./contract";
import { listCameras } from "./service";

export const camerasRouter = router({
  list: publicProcedure
    .input(z.object({}).optional())
    .output(z.array(cameraSchema))
    .query(listCameras),
});

export const api = defineApi(router({ cameras: camerasRouter }));
