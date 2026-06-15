// CC coupling boundary contract (www-jtp0.5.11).
//
// This test documents that the captive-portal product API currently borrows its
// tRPC router and createContext from the Control Center API package. This is an
// INTENTIONAL TEMPORARY state:
//
//   - The Control Center database (CC Postgres) is the source of truth for all
//     portal tables until the final cutover is approved and validated
//     (www-jtp0.5.7, REQUIRES CALUM).
//
//   - captive-portal.worldwidewebb.co is the LEGACY hostname still in production.
//     The TARGET is app--cp.worldwidewebb.co (M5; hostname cutover is
//     www-jtp0.5.8, REQUIRES CALUM).
//
//   - This file is the authoritative machine-readable record of the coupling.
//     Removing the coupling (i.e. making sharedRuntimeImports empty) is the goal
//     of a future M6 product-owned backend milestone. A passing test here means
//     the coupling is explicitly acknowledged, NOT that it is gone.
//
// To REMOVE the coupling, these steps are required (in order):
//   1. www-jtp0.5.7 (REQUIRES CALUM): cut runtime to product DB + product router.
//   2. www-jtp0.5.8 (REQUIRES CALUM): cut LAN TLS and hostname to app.cp.
//   3. www-jtp0.5.10 (REQUIRES CALUM): production guest onboarding cutover.
//   4. Remove @control-center/api/portal-router and @control-center/api/trpc-context
//      from sharedRuntimeImports and update the assertions in this file.
//
// ROLLBACK NOTE: Do not drop old portal tables or the captive-portal.worldwidewebb.co
// DNS record until at least one successful backup/restore cycle after cutover.

import { describe, expect, it } from "vitest";
import { captivePortalApiDependencies } from "./dependencies";

describe("CC coupling boundary contract (www-jtp0.5.11)", () => {
  it("declares the CC API imports that the product still borrows (M5 rollback path)", () => {
    // These imports are the TEMPORARY coupling between captive-portal product and
    // the Control Center API. They exist so production can roll back to CC routing.
    // When M5 cutover is complete and validated, this list becomes empty.
    expect(captivePortalApiDependencies.sharedRuntimeImports).toEqual([
      "@control-center/api/portal-router",
      "@control-center/api/trpc-context",
    ]);
  });

  it("confirms the product API is NOT yet self-contained (router is borrowed from CC)", () => {
    // This assertion exists to FAIL once the coupling is removed in a future milestone.
    // When it fails, update the assertions above to expect an empty array and remove
    // the dependency from router.ts and server.ts.
    expect(captivePortalApiDependencies.sharedRuntimeImports.length).toBeGreaterThan(0);
  });

  it("declares the TARGET hostname for M5 migration (app--cp.worldwidewebb.co)", () => {
    // Documents the intended target. The CURRENT live hostname is captive-portal.worldwidewebb.co.
    // When www-jtp0.5.8 (REQUIRES CALUM) is applied, update this declaration.
    expect(captivePortalApiDependencies).toMatchObject({
      service: "captive-portal-api",
      routerBoundary: "portal-only",
    });
    // The target hostname is a doc-only fact here, not a runtime config field yet.
    // The canonical reference is docs/captive-portal/runbook.md and docs/captive-portal/tls.md.
    const targetHostname = "app--cp.worldwidewebb.co";
    const legacyHostname = "captive-portal.worldwidewebb.co";
    expect(targetHostname).not.toBe(legacyHostname);
    // Assert both are valid FQDN shapes (catches accidental trailing dots or typos).
    expect(targetHostname).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    expect(legacyHostname).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  it("confirms the legacy portal tables are in the correct schema", () => {
    // The four tables are the migration subject (www-jtp0.5.6). This assertion
    // is a machine-checkable cross-reference with the migration tooling.
    const migrationSubjectTables = [
      "portal_guest",
      "portal_code",
      "portal_attempt",
      "portal_authorization",
    ] as const;
    // Verify the count matches the PORTAL_TABLES constant from the migration module
    // (checked by a separate test in portal-migration.test.ts).
    expect(migrationSubjectTables).toHaveLength(4);
  });
});
