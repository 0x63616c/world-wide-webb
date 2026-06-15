# Captive Portal

Product boundary for guest WiFi onboarding.

The frontend app lives in `products/captive-portal/apps/frontend`.

The product-owned API boundary lives in `products/captive-portal/apps/api`. It exposes only the portal tRPC surface (`portal.sendCode`, `portal.verifyCode`, `portal.checkPassword`, `portal.authorize`, `portal.status`, and `portal.resetAttempts`) and declares its Resend, UniFi, logger, and secret inputs explicitly.

## M5 coupling status (2026-06-14)

**The CC API coupling is INTENTIONAL and TEMPORARY.** The product API still imports
`portalRouter` and `createContext` from `@control-center/api` as a rollback path.
This is documented in `apps/api/src/cc-coupling-boundary.test.ts` and
`apps/api/src/dependencies.ts` (`sharedRuntimeImports`).

The coupling will be removed when:
1. www-jtp0.5.7 (REQUIRES CALUM): runtime cut to product DB + product-owned router
2. www-jtp0.5.8 (REQUIRES CALUM): LAN TLS and hostname cut to `app.cp.worldwidewebb.co`
3. www-jtp0.5.10 (REQUIRES CALUM): production guest onboarding cutover validated

**LEGACY hostname:** `captive-portal.worldwidewebb.co` (still live in production).
**TARGET hostname:** `app.cp.worldwidewebb.co` (M5; DNS declared in `infra/unifi`,
gated behind `ccunifi:applyAppCp=true`; REQUIRES CALUM to apply).

**ROLLBACK NOTE:** Do not drop old portal tables or the legacy DNS record until at
least one successful backup/restore cycle after cutover is validated.

Migration tooling is in `products/captive-portal/scripts/` (`portal-export.sh`,
`portal-import.sh`, `portal-validate.sh`) and tested in
`apps/api/src/migration/portal-migration.test.ts`.
