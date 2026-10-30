import { defineWorkerCycles } from "@app-kit";
import { notificationService } from "./service";
export const cycles = defineWorkerCycles([
  {
    name: "notifications-prune",
    intervalMs: 60 * 60_000,
    runOnStart: true,
    run: async () => {
      await notificationService.prune();
    },
  },
]);
