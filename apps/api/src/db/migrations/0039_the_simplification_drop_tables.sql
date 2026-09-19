-- The Simplification (§7): drop every table whose owning App, product or
-- subsystem was deleted in the same PR. 26 tables go; NINE survive:
-- settings, device_settings, lamp_mode, booth_photo, wake_photo,
-- weather_reading, weather_daily_reading, device_state,
-- integration_sync_status. (SIMPLIFICATION.md §7 says "keep 11" and names ten,
-- the tenth being `device_commands` — which migration 0018 already dropped.)
--
-- Hand-written rather than drizzle-kit-generated: the generated schema barrel
-- can no longer reach the deleted features' schema.ts files to diff against.
-- The accompanying meta/0039_snapshot.json IS updated, so the next
-- `bun run db:generate` diffs against the post-drop world and does not try to
-- re-emit these drops.
--
-- Ordered children-before-parents so the FK graph is respected on its own
-- terms; CASCADE is kept (drizzle-kit's own convention here, see 0018/0034)
-- as the backstop for indexes and any constraint the snapshot does not model.
--
-- NOT REVERSIBLE. A fresh pg_dump was taken and verified on the NAS before this
-- ran (SIMPLIFICATION.md §0), which is the only recovery path for the data.

-- injections: actual_injection/check_in/photo/vial all FK injection_course.
DROP TABLE IF EXISTS "actual_injection" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "injection_check_in" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "injection_photo" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "injection_vial" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "injection_course" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "injection_settings" CASCADE;--> statement-breakpoint

-- goals: goal_checkin + goal_schedule FK goal.
DROP TABLE IF EXISTS "goal_checkin" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "goal_schedule" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "goal_vacation" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "goal" CASCADE;--> statement-breakpoint

-- scenes: scene_run FKs scene.
DROP TABLE IF EXISTS "scene_run" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "scene" CASCADE;--> statement-breakpoint

-- deploys (GitHub Actions pipeline + its poll cursor).
DROP TABLE IF EXISTS "github_run_log_tail" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "github_run" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "github_poll_status" CASCADE;--> statement-breakpoint

-- events: the Upcoming tile. features/events survives as the clock face only.
DROP TABLE IF EXISTS "events" CASCADE;--> statement-breakpoint

-- guest-wifi: the captive portal's rate limiter + authorization ledger.
DROP TABLE IF EXISTS "portal_authorization" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "portal_rate_limit" CASCADE;--> statement-breakpoint

-- hooks: the inbound GitHub App webhook log.
DROP TABLE IF EXISTS "incoming_webhook" CASCADE;--> statement-breakpoint

-- notif: Notification Center + its APNs device registrations.
DROP TABLE IF EXISTS "notification" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "device_push_token" CASCADE;--> statement-breakpoint

-- felogs: the panel's frontend log pipeline. Activity (features/wakes) now
-- derives a visit from wake_photo instead of grouping rows here.
DROP TABLE IF EXISTS "frontend_log" CASCADE;--> statement-breakpoint

-- weight: Withings ingest + its stored OAuth token.
DROP TABLE IF EXISTS "weight_measurement" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "withings_oauth_token" CASCADE;--> statement-breakpoint

-- panel-update: the cached latest-TestFlight-build row behind the update
-- banner. Listed in SIMPLIFICATION.md §2 but missing from its §7 table list;
-- its owning App is deleted, so the table would otherwise be orphaned.
DROP TABLE IF EXISTS "asc_build_status" CASCADE;--> statement-breakpoint

-- The durable job queue itself (§3). Nothing declares a jobs.ts facet any more:
-- weather's retention purge is a plain worker cycle now.
DROP TABLE IF EXISTS "job" CASCADE;
