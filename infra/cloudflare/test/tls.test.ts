// Tests for nested-host TLS cert packs (www-jtp0.3.5).
//
// The `nestedTlsCertPacks` function is a pure data function (no Pulumi
// CustomResource instantiation), so we test its declaration in unit tests
// without the Pulumi mock runtime.
//
// The Pulumi program gate (applyNestedTls flag) is verified via the pure data
// layer: when the flag is false, the program never calls
// `applyNestedTlsCertPacks`, so zero resources are emitted. We assert that the
// pack list itself is correct and non-empty (flag ON contract) and document
// the flag-OFF invariant here.

import { describe, expect, test } from "vitest";
import { nestedTlsCertPacks } from "../src/tls.ts";

const ZONE = "worldwidewebb.co";

describe("nestedTlsCertPacks", () => {
  test("emits exactly one cert pack per tunnel-routed product (tye, cc, amp)", () => {
    const packs = nestedTlsCertPacks(ZONE);
    const wildcards = packs.map((p) => p.wildcardHostname).sort();

    expect(wildcards).toEqual([
      "*.amp.worldwidewebb.co",
      "*.cc.worldwidewebb.co",
      "*.tye.worldwidewebb.co",
    ]);
  });

  test("each cert pack includes the apex zone name (CF ACM requirement)", () => {
    for (const pack of nestedTlsCertPacks(ZONE)) {
      expect(pack.zoneName).toBe(ZONE);
    }
  });

  test("resource names are stable and follow the tls-<code>-wildcard convention", () => {
    const names = nestedTlsCertPacks(ZONE)
      .map((p) => p.resourceName)
      .sort();

    expect(names).toEqual(["tls-amp-wildcard", "tls-cc-wildcard", "tls-tye-wildcard"]);
  });

  test("does NOT include captive-portal (cp): LAN-only, handled by cert-manager DNS-01", () => {
    const wildcards = nestedTlsCertPacks(ZONE).map((p) => p.wildcardHostname);
    expect(wildcards).not.toContain("*.cp.worldwidewebb.co");
    expect(wildcards.some((w) => w.includes(".cp."))).toBe(false);
  });

  test("wildcard hostnames are derived from product DNS codes, not hard-coded strings", () => {
    // Verify derivation works with a different zone; proves the list is not
    // hard-coded to worldwidewebb.co.
    const devZone = "dev.example.com";
    const devPacks = nestedTlsCertPacks(devZone);
    const devWildcards = devPacks.map((p) => p.wildcardHostname).sort();

    expect(devWildcards).toEqual([
      "*.amp.dev.example.com",
      "*.cc.dev.example.com",
      "*.tye.dev.example.com",
    ]);
  });

  // FLAG-OFF CONTRACT (www-jtp0.3.5):
  // When `applyNestedTls` is false (the default), the Pulumi program never
  // calls `applyNestedTlsCertPacks`, so zero CertificatePack resources are
  // emitted. This is enforced by the `if (applyNestedTls)` branch in
  // program.ts. The pure data function `nestedTlsCertPacks` always returns the
  // full descriptor list regardless. The gate lives at the call site, not here.
  test("pack list is non-empty regardless of gate (gate is enforced at the call site in program.ts)", () => {
    expect(nestedTlsCertPacks(ZONE).length).toBeGreaterThan(0);
  });
});
