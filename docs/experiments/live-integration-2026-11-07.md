# Live integration checkpoint — 2026-11-07

Deployment identity: `5675b3e92263e46b4431acbb24fce7018e3c74da`. Generated runtime files and logs are under ignored `build/runtime/`; no credentials or raw CloudKit records are committed.

| Area | Verified | Still open |
| --- | --- | --- |
| CloudKit management | One-year team token created in Console, expires November 7, 2027, saved in Folding 1Password vault. `cktool export-schema` authenticates against staging Development. | Container schemas and application sync. |
| CloudKit bootstrap | Staging and production Debug bootstrap builds succeeded; both installed on the dedicated Duo simulator. | Staging bootstrap launch failed because the simulator has no Apple Account signed in. Settings displayed “Sign in to access your iCloud data.” Staging Development export currently contains only Apple's default `Users` record type. Sign in, initialize both containers, capture receipts, export/validate, promote in Console, and verify Production readback. |
| Staging D1 | Checksum wrapper verified all 17 migrations. Evidence: `build/migrations/staging/fa0597c5-5266-4341-962b-acfb7b022373`. | Live feature flows. |
| Production D1 | Checksum wrapper verified all 17 migrations. Evidence: `build/migrations/production-live-20261107`. | Live feature flows. |
| Workers | Both Workers deployed with the exact commit, correct environment bindings, and six required secrets each. Staging deployment version before secret changes: `044767da-2213-49ea-ad5d-d59ab86bb217`; production: `314b72ad-161f-4540-802d-a3158e9012db`. | Authentication, queues, avatars, APNs and other acceptance checks. |
| Routes | OpenTofu created only the two API/admin DNS records and two Worker routes per environment. Both `GET /v1/health` returned HTTP 200, status `ok`, and the exact commit. Both `/v1/capabilities` returned HTTP 200 with `capabilities: []`. Both unauthenticated admin hosts returned HTTP 302 to Access. Through the existing authorized browser session, `/admin/config` rendered in both environments at revision 0; staging `/admin/jobs` rendered without failed jobs. | Admin mutations and feature validation. |
| State recovery | Encrypted state copied to R2 recovery keys `backups/staging/20261107T210510Z-2931ed3c-a964-4b62-aa06-813f39ecf1e3.tfstate` and `backups/production/20261107T210822Z-dc766870-1b81-47c5-972a-bdb6d4e641d2.tfstate`, then byte-verified. | Restore drill remains later operational work. |

The route plans used explicit OpenTofu targets to exclude the deferred monitoring module's watchdog database. The module remains pending; this checkpoint does not claim monitoring acceptance. Feature flags and advertised capabilities remain disabled until their own live acceptance evidence exists.
