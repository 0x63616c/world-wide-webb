// Re-export the settings contract for the web client. Unlike ./trpc, this is a
// VALUE re-export , the constants really do ship in the browser bundle. That is
// safe only because `@control-center/api/contract` imports nothing at all; keep
// it that way, or the panel starts pulling drizzle and pg over the wire.
export {
  ACCENTS,
  type Accent,
  DEFAULT_TIME_ZONE,
  SETTINGS_DEFAULTS,
} from "@control-center/api/contract";
