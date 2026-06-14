export const captivePortalApiDependencies = {
  service: "captive-portal-api",
  routerBoundary: "portal-only",
  integrationDependencies: ["resend", "unifi"] as const,
  secretNames: ["RESEND_API_KEY", "RESEND_FROM", "UNIFI_API_KEY", "WIFI_PASSWORD"] as const,
  sharedRuntimeImports: ["@repo/api/portal-router", "@repo/api/trpc-context"] as const,
} as const;
