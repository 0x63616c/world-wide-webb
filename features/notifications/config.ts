import { ENV } from "@www/platform/env";
export const config = ENV.pick("DATABASE_URL");
