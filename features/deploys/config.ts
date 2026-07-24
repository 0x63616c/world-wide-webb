/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick("GITHUB_ACTIONS_TOKEN", "GITHUB_REPO", "DATABASE_URL");
