/**
 * Apple Push Notification service sender for the Notification Center. The
 * `notify` job (notification-service) calls sendApnsPush once per registered
 * device after a notification row is written.
 *
 * Env-gated exactly like github-actions-service: with no key material
 * isApnsConfigured() is false and every send is a logged no-op, so the api and
 * workers boot fine on a machine that has never been given a push key.
 *
 * HOST: TestFlight builds carry a PRODUCTION push entitlement, so the default
 * host is api.push.apple.com, NOT the sandbox. Only a debug build installed
 * straight from Xcode needs APNS_HOST pointed at the sandbox.
 *
 * TOKEN LIFECYCLE: APNs answers 410 (or 400 BadDeviceToken) when a token no
 * longer addresses an installed app , the user deleted the app, restored the
 * device, or the token was reissued and we still hold the old one. That is not a
 * transient error and retrying it never succeeds, so the sender deletes the
 * stale device_push_token row. The device re-registers on its next boot.
 */
import { getLogger } from "@www/logger";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import { env } from "../env";

/** APNs provider JWTs are valid at most 1h; Apple rejects reuse under ~20min. */
const JWT_TTL_SECONDS = 30 * 60;

/** Per-request timeout; APNs is normally single-digit ms from the cluster. */
const REQUEST_TIMEOUT_MS = 8000;

export function isApnsConfigured(): boolean {
  return Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_KEY_CONTENT && env.APNS_BUNDLE_ID);
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes).toString("base64url");
}

function pemToPkcs8(keyContent: string): ArrayBuffer {
  // Same dual-form handling as asc-version-service: the vault stores the .p8
  // base64-encoded (fastlane consumes it with is_key_content_base64: true), so
  // the mounted secret usually has no PEM armor. Accept both.
  const pem = keyContent.includes("BEGIN")
    ? keyContent
    : Buffer.from(keyContent.replace(/\s+/g, ""), "base64").toString("utf-8");
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(Buffer.from(b64, "base64")).buffer;
}

/**
 * Sign an APNs provider JWT (ES256) from the .p8 key. Uses Web Crypto
 * (crypto.subtle), NOT node:crypto: JWT ES256 requires the raw R||S signature
 * that subtle emits natively, and Bun's createSign with
 * `dsaEncoding: "ieee-p1363"` throws RangeError (verified 2026-07-11).
 *
 * Differs from the ASC JWT only in its claims: APNs wants the team id as `iss`
 * and no `aud`, where ASC wants the issuer id plus aud "appstoreconnect-v1".
 */
export async function signApnsJwt(
  keyId: string,
  teamId: string,
  p8Pem: string,
  nowMs = Date.now(),
): Promise<string> {
  const nowSec = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = { iss: teamId, iat: nowSec, exp: nowSec + JWT_TTL_SECONDS };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(p8Pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

/** The alert payload pushed to a device for one notification. */
export interface ApnsAlert {
  notificationId: string;
  title: string;
  body?: string | null;
  category: string;
  severity: string;
  deepLink?: string | null;
  /** Unread count to render on the app icon badge. */
  badge?: number;
}

/** Build the APNs JSON body. Exported so tests can assert the wire shape. */
export function buildApnsPayload(alert: ApnsAlert): Record<string, unknown> {
  return {
    aps: {
      alert: { title: alert.title, ...(alert.body ? { body: alert.body } : {}) },
      sound: alert.severity === "critical" ? "default" : undefined,
      ...(alert.badge === undefined ? {} : { badge: alert.badge }),
    },
    // Custom keys ride alongside `aps` so the shell can route the tap without a
    // second round-trip to the API.
    notificationId: alert.notificationId,
    category: alert.category,
    severity: alert.severity,
    ...(alert.deepLink ? { deepLink: alert.deepLink } : {}),
  };
}

export type ApnsSendResult = "sent" | "skipped" | "stale" | "failed";

/**
 * Push one alert to one device token. Returns a result rather than throwing so
 * one dead device can never fail the whole fan-out job:
 *   - "skipped" , APNs not configured (no-op)
 *   - "stale"   , token rejected as unregistered; the row has been deleted
 *   - "failed"  , transient/unknown error, the job may retry
 */
export async function sendApnsPush(
  db: NodePgDatabase<typeof schema>,
  deviceToken: string,
  alert: ApnsAlert,
): Promise<ApnsSendResult> {
  const log = getLogger();
  if (!isApnsConfigured()) {
    log.debug({ notificationId: alert.notificationId }, "apns not configured, skipping push");
    return "skipped";
  }

  try {
    const jwt = await signApnsJwt(env.APNS_KEY_ID, env.APNS_TEAM_ID, env.APNS_KEY_CONTENT);
    const res = await fetch(`${env.APNS_HOST}/3/device/${deviceToken}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": env.APNS_BUNDLE_ID,
        "apns-push-type": "alert",
      },
      body: JSON.stringify(buildApnsPayload(alert)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.ok) return "sent";

    // APNs reports the reason in a JSON body ({"reason":"BadDeviceToken"}); a
    // 410 means Unregistered. Both are permanent for this token.
    const text = await res.text().catch(() => "");
    const isStale =
      res.status === 410 || text.includes("BadDeviceToken") || text.includes("Unregistered");
    if (isStale) {
      await db.delete(schema.devicePushToken).where(eq(schema.devicePushToken.token, deviceToken));
      log.info({ status: res.status }, "apns token stale, deleted device_push_token row");
      return "stale";
    }
    log.warn({ status: res.status, body: text }, "apns push failed");
    return "failed";
  } catch (err) {
    log.warn({ err, notificationId: alert.notificationId }, "apns push threw");
    return "failed";
  }
}
