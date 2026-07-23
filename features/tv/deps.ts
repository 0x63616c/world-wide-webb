/**
 * The tv feature's own HA client (Track C, Wave 6). The client itself is
 * env-free in `@www/core`; this binds it to the feature's own config slice,
 * mirroring features/ac/deps.ts and features/ctrl/deps.ts.
 */
import { createHomeAssistantClient } from "@www/core";
import { config } from "./config";

export const ha = createHomeAssistantClient({ baseUrl: config.HA_URL, token: config.HA_TOKEN });
