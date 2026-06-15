// Cloudflare Advanced Certificate Manager (ACM) cert packs for nested-host TLS
// (www-jtp0.3.5).
//
// WHY CertificatePack over TotalTls:
//   TotalTls enables full-zone coverage in one shot but is a blunt instrument:
//   it issues one wildcard per zone level and cannot be scoped to specific
//   products. CertificatePack is per-resource and per-hostname; we issue
//   exactly the three product wildcards we need (*.tye.*, *.cc.*, *.amp.*),
//   no more, and each has its own lifecycle, CA choice, and validity period.
//   This matches the M3 contract: networking/TLS is a product-platform
//   primitive, not a zone-wide policy.
//
// GATE: all resources are guarded by the `applyNestedTls` config flag (default
// false). The flag must be explicitly set to `true` before a `pulumi up` will
// create anything. This keeps the live stack unaffected until Calum has
// confirmed ACM is enabled on the zone and has reviewed the plan.

import * as cloudflare from "@pulumi/cloudflare";
import type * as pulumi from "@pulumi/pulumi";
import {
  ampProductManifest,
  controlCenterProductManifest,
  textYourExProductManifest,
} from "@repo/platform";

/** A description of one ACM cert pack we want to issue. */
export interface NestedTlsCertPack {
  // Pulumi logical resource name (e.g. "tls-tye-wildcard").
  resourceName: string;
  // The wildcard hostname the pack covers (e.g. "*.tye.worldwidewebb.co").
  wildcardHostname: string;
  // The apex zone domain (must be included alongside the wildcard per CF docs).
  zoneName: string;
}

/**
 * Derive one cert pack descriptor per product manifest that has a nested-host
 * wildcard. Products expose their DNS code via the platform identity; we build
 * `*.<dnsCode>.<zone>` from that rather than maintaining a separate hard-coded
 * list.
 *
 * Only the three tunnel-routed products (tye / cc / amp) have nested-host
 * exposure today. captive-portal (cp) is LAN-only and handled by cert-manager
 * DNS-01, not Cloudflare ACM.
 */
export function nestedTlsCertPacks(zoneName: string): readonly NestedTlsCertPack[] {
  const manifests = [
    controlCenterProductManifest(),
    ampProductManifest(),
    textYourExProductManifest(),
  ] as const;

  return manifests.map((m) => {
    const code = m.product.dnsCode;

    return {
      resourceName: `tls-${code}-wildcard`,
      wildcardHostname: `*.${code}.${zoneName}`,
      zoneName,
    };
  });
}

/**
 * Apply ACM `CertificatePack` resources for every product's nested-host
 * wildcard. Call only when `applyNestedTls` config flag is true; the Pulumi
 * program gate ensures the live stack is unaffected while the flag is false.
 *
 * Each pack uses:
 *   - `google` CA (ACM Advanced; requires ACM subscription on the zone)
 *   - `txt` validation (DNS TXT; Cloudflare manages the record automatically
 *     for proxied zones)
 *   - 365-day validity
 *
 * The hosts list MUST include the apex zone alongside the wildcard; the CF
 * provider enforces this for ACM packs. We include both.
 */
export function applyNestedTlsCertPacks(
  packs: readonly NestedTlsCertPack[],
  zoneId: pulumi.Input<string>,
  opts: pulumi.CustomResourceOptions,
): readonly cloudflare.CertificatePack[] {
  return packs.map(
    (pack) =>
      new cloudflare.CertificatePack(
        pack.resourceName,
        {
          zoneId,
          type: "advanced",
          // google = Cloudflare ACM (Advanced Certificate Manager).
          // digicert/letsEncrypt would also work but ACM via google CA is the
          // preferred path for per-product wildcard coverage.
          certificateAuthority: "google",
          // txt validation: CF auto-provisions the DNS TXT records for proxied
          // zones, so no manual DNS step is required.
          validationMethod: "txt",
          // 365 days is the maximum for ACM advanced packs.
          validityDays: 365,
          // CF requires the apex zone domain alongside each wildcard in the
          // hosts list for ACM packs.
          hosts: [pack.wildcardHostname, pack.zoneName],
        },
        opts,
      ),
  );
}
