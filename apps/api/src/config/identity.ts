// Cross-service device identity. These are the stable IDs services rendezvous on;
// they live here, not in any one enforcer, because no service owns another's identity.
// CLIMATE_DEVICE_ID now lives in @www/core (features/ac/service.ts needs it and
// can't import apps/api); re-exported here so apps/api's staying importers
// (climate-enforcer-service.ts, controls-service.ts) stay zero-churn.
export { CLIMATE_DEVICE_ID } from "@www/core";
export const TOPOLOGY_ANCHOR_IP = "192.168.0.193";
export const DESK_RF_BONDED_UUID = "RINCON_804AF288FDBA01400";
