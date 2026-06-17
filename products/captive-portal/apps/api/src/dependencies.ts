export const captivePortalApiDependencies = {
  service: "captive-portal-api",
  routerBoundary: "portal-only",
  integrationDependencies: ["unifi"] as const,
  secretNames: [
    "POSTGRES_PASSWORD",
    "UNIFI_API_KEY",
    "WIFI_PASSWORD",
    "WIFI_SSID",
  ] as const,
  sharedRuntimeImports: [
    "@control-center/api/portal-router",
    "@control-center/api/trpc-context",
  ] as const,
} as const;
