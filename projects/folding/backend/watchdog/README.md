# Availability watchdog

A separate Rust Cron Worker probes the API once per minute. It owns a separate D1 database and can remember an app-database outage. Five **observed, consecutive minute slots** failing health create one incident. The first later successful check queues one recovery. A skipped scheduler slot resets the failure streak; duplicate/late deliveries never count twice. An open incident stays open across missed slots and repeated failures.

The probe is fixed to `/v1/health` on `api.getfolding.app`. It follows no redirects, accepts only HTTP 200 plus the bounded health contract (status and 40-character deployed commit), and times out after three seconds. The API itself checks its indexed D1 control record within two seconds. No user data is read by the watchdog.

The D1 singleton has a 45-second lease. Probe state and any new notification enter one D1 batch, fenced by that lease. Notification claims consume attempts before external I/O; expired leases are reclaimable after restart. At most two sends occur per invocation, each with a ten-second timeout. Retries start at 30 seconds, cap at one hour, add up to five seconds jitter, and stop after 12 attempts. Cron resolution rounds retry times to the next minute. A recovery waits until the incident's outage notice is delivered or dead-lettered. Terminal notices expire after 90 days, up to 50 per run, except the currently active incident. No raw response, message, address or transport error is logged.

There is one **logical** notice per incident/category, enforced by a unique key. A send accepted just before an acknowledgement is lost can repeat; stable Message-ID helps receivers but does not promise exactly-once delivery. Mail is sent only to the hardcoded owner, additionally enforced by the Cloudflare binding. This is operational mail, not app notification infrastructure.

## Deployment ownership and defaults

OpenTofu `projects/folding/infra/cloudflare/modules/monitoring` owns only the isolated D1 database. The production root exposes `monitoring_bindings`. Wrangler owns the Worker, its bindings and Cron schedule in a single deploy; no second Terraform resource manages the same schedule. The crate has its own workspace/lockfile and does not modify the API artifact.

Both root variables default false:

- `monitoring_enabled`
- `monitoring_outbound_delivery_verified`

The generated disabled configuration has **no cron triggers**, no public route/preview/Workers.dev hostname, and runtime sending disabled. Config generation refuses scheduling unless delivery verification is recorded. Removing a schedule requires redeploying the generated configuration, not only changing OpenTofu outputs. Do not describe the monitor as active until that deploy and real delivery acceptance succeed.

Only the primary agent performs the following credential-dependent operations, using its persistent secret session. Never print tokens or email message payloads.

1. Apply the corresponding OpenTofu root with both switches false. Export `tofu output -json` to ignored `build/monitoring/<environment>/bindings.json`.
2. Generate, compile, migrate and deploy from the exact committed source:

   ```sh
   python3 scripts/generate-watchdog-config.py \
     --bindings build/monitoring/production/bindings.json \
     --output build/monitoring/production/wrangler.json \
     --destination "$FOLDING_ALERT_DESTINATION"
   backend/watchdog/build-worker
   python3 scripts/migrate-d1.py apply --database-kind watchdog \
     --configuration build/monitoring/production/wrangler.json --environment production
   node backend/node_modules/wrangler/bin/wrangler.js deploy \
     --config build/monitoring/production/wrangler.json
   ```

   Use production paths/argument only for the production root. The shared migration wrapper records original source checksums in the same migration as schema changes and validates the exact isolated target. Never substitute a direct unledgered migrations apply.

3. Primary verifies that `getfolding.app` can send from `alerts@getfolding.app` to the existing verified owner destination using the official Email Service API. Confirm actual inbox receipt; inbound forwarding alone is not evidence. No new arbitrary recipients or paid subscription is authorized by this module. Record provider acceptance and inbox verification time without copying mail payloads or credentials into Git. Sender onboarding may require an account/bootstrap action.
4. Set both switches true in the root only after that evidence; apply, export outputs, regenerate and deploy again. Verify the restricted binding and one-minute Cron readback. Complete incident/recovery acceptance below before production activation.
5. Roll back code using a compatible prior Worker artifact; never automatically roll back D1. To stop sends/checks, set switches false and redeploy generated no-cron config. Preserve D1 evidence. Inspect dead notices via authenticated D1 access; requeue only after a documented operator decision, retaining the incident/category identity.

## Final acceptance still required

Implementation-first work intentionally defers runtime/fault tests. Verify local workerd plus an explicitly authorized production diagnostic: duplicate/concurrent Cron, five failures, a skipped slot, healthy reset, failed request/body/redirect/timeout, DB probe failure, recovery ordering, probe/notice lease crash and restart, ambiguous email send, retry exhaustion, retention bounds, disabled configuration and exact owner-only binding. Verify SQL batch rollback and the watchdog checksum migration through pinned Wrangler. Measure actual email receipt and operator response; no delivery has been demonstrated by compilation.

This monitor is external to the **application deployment**, but remains on Cloudflare. A platform-wide Workers, D1, Cron or Email outage can suppress its own alerts. An independently hosted monitor would be needed for that failure domain; none is secretly purchased or claimed here. Free-tier limits/quotas still apply. Ingestion-rate, finalization-delay and dead-letter-growth email alert wiring are separate acceptance items; this module implements the five-consecutive-health-failures requirement only.

## Sources and plan choice

- [Cloudflare Health Checks](https://developers.cloudflare.com/health-checks/) are not available on Free; standalone paid checks were not provisioned.
- [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) permits free sending to verified account destinations, including Routing-only accounts. Arbitrary outbound sending has different plan requirements.
- [Send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/) documents `destination_address` restrictions.
- [Worker email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) documents `EmailMessage` and send behavior. This uses the pinned workers-rs 0.8.7 binding rather than guessed HTTP endpoints.
