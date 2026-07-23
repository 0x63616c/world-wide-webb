/**
 * The notif feature's own config slice (Track C, S1). A folded feature owns
 * its configuration surface: it reads the already-hydrated `process.env`
 * (apps/api's env.ts runs the docker-secret hydration + writes DATABASE_URL
 * back onto process.env before any feature is imported) and validates just the
 * keys this feature needs. It never reaches into apps/api's `env`.
 *
 * Every field carries a safe default so importing the feature , in the api
 * runtime, in the tests, and in the `apps:gen`/`apps:check` codegen that
 * imports the branded facets , never throws before a real value is wired. An
 * unconfigured APNs key means `isApnsConfigured()` is false and the notify job
 * no-ops (mirrors apps/api's pre-fold env.ts).
 */
import { z } from "zod";

export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
    // APNS_BUNDLE_ID is the app's bundle identifier (the APNs topic); it is not
    // secret, so it defaults here instead of riding the secret rail.
    APNS_KEY_ID: z.string().default(""),
    APNS_TEAM_ID: z.string().default(""),
    APNS_KEY_CONTENT: z.string().default(""),
    APNS_BUNDLE_ID: z.string().default("co.worldwidewebb.theworkflowengine"),
    // APNs host. The shell app ships via TestFlight, and TestFlight builds
    // carry a PRODUCTION push entitlement , they are NOT sandbox. So this
    // defaults to the production host and only a local debug build (installed
    // from Xcode) ever needs to override it to api.sandbox.push.apple.com.
    APNS_HOST: z.string().default("https://api.push.apple.com"),
  })
  .parse(process.env);
