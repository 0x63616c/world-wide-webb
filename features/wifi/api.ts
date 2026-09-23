/**
 * tRPC `wifi` facet: the guest-network join payload the Wi-Fi tile encodes as
 * a QR code. The SSID and password exist ONLY inside that payload — nothing
 * here (or on the tile) renders them as text. Reaches the tRPC runtime only
 * through @app-kit/server; codegen collects the top-level key `wifi`.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { config } from "./config";

/** Escape a value for a WIFI: QR payload — backslash, semicolon, comma, colon
 * and double-quote are structural and must be backslash-escaped. */
function escapeWifiQrValue(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** The full WIFI: join payload, or "" when no SSID is configured. Pure so the
 * escaping is unit-testable. */
export function buildWifiQrPayload(ssid: string, password: string): string {
  if (!ssid) return "";
  if (!password) return `WIFI:T:nopass;S:${escapeWifiQrValue(ssid)};;`;
  return `WIFI:T:WPA;S:${escapeWifiQrValue(ssid)};P:${escapeWifiQrValue(password)};;`;
}

const wifiRouter = router({
  guestQr: publicProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        qr: z.string().describe("WIFI: join payload for the guest network, '' when unconfigured"),
      }),
    )
    // Both are optional secrets (undefined until the vault carries them); the
    // payload builder treats a missing SSID as "not configured".
    .query(() => ({
      qr: buildWifiQrPayload(config.WIFI_GUEST_SSID ?? "", config.WIFI_GUEST_PASSWORD ?? ""),
    })),
});

/** The branded `api` facet — single top-level key `wifi`. */
export const api = defineApi(router({ wifi: wifiRouter }));
