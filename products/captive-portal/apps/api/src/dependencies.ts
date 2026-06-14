export const captivePortalApiDependencies = {
  service: "captive-portal-api",
  routerBoundary: "portal-only",
  integrationDependencies: ["resend", "unifi"] as const,
  secretNames: [
    "POSTGRES_PASSWORD",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "UNIFI_API_KEY",
    "WIFI_PASSWORD",
    "WIFI_SSID",
  ] as const,
  sharedRuntimeImports: [
    "@control-center/api/portal-router",
    "@control-center/api/trpc-context",
  ] as const,
} as const;
