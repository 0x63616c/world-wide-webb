// Cross-service device identity for the climate rendezvous. Lives in @www/core
// (not apps/api) because features/ac/service.ts, apps/api's
// climate-enforcer-service.ts, and apps/api's controls-service.ts all need the
// same ID and none of those services owns another's identity.
export const CLIMATE_DEVICE_ID = "climate-thermostat";
