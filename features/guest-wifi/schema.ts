// Captive-portal domain schema (www-q002, password-only since www-p9hx),
// folded into the guest-wifi feature (Track C, C7). The codegen collects every
// exported `pgTable` from a feature's schema.ts into the generated schema barrel
// (features/_generated/schema.gen.ts), which drizzle-kit reads. Guest WiFi
// onboarding at the LAN captive portal: a guest enters the shared WiFi password
// and gets 30 days of internet per device via UniFi authorize-guest. UTC
// throughout.
import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Global wrong-password rate limit (www-p9hx). The portal is password-only: a
// single shared WiFi password (no email/OTP), so there is no per-device identity
// to meaningfully rate-limit (an open SSID lets an attacker rotate MACs freely).
// Instead a single global counter caps wrong password attempts per UTC calendar
// day. `dateUtc` (YYYY-MM-DD) scopes the count to one day; crossing midnight UTC
// resets it. Singleton: exactly one row, id = PORTAL_RATE_LIMIT_ID.
export const portalRateLimit = pgTable("portal_rate_limit", {
  id: text("id").primaryKey(), // constant 'global'
  dateUtc: text("date_utc").notNull(), // YYYY-MM-DD (UTC) the count applies to
  wrongAttempts: integer("wrong_attempts").notNull().default(0),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// A granted device authorization. The DB is the source of truth for the 30-day
// window (mirrors the lights desired-state model); UniFi is the actuator. One
// row per device MAC (unique) so re-authorizing the same device is an
// idempotent upsert. status(mac) reads this: active (now < expires) →
// AlreadyConnected; expired row → SessionExpired; none → fresh flow. Password-only
// means the MAC is the sole identity, no guest row.
export const portalAuthorization = pgTable(
  "portal_authorization",
  {
    id: text("id").primaryKey(), // Stripe-style auth_<id>
    mac: text("mac").notNull(),
    grantedAtUtc: timestamp("granted_at_utc", { withTimezone: true }).notNull().defaultNow(),
    expiresAtUtc: timestamp("expires_at_utc", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("portal_authorization_mac_idx").on(t.mac)],
);

/** @public - constant primary key for the portalRateLimit singleton row. */
export const PORTAL_RATE_LIMIT_ID = "global";
