// Cross-service device identity. These are the stable IDs services rendezvous on;
// they live here, not in any one enforcer, because no service owns another's identity.
// CLIMATE_DEVICE_ID already lives at ./device-state/identity.ts (re-exported from
// index.ts); this module holds the remaining cross-service identity consts.
export const TOPOLOGY_ANCHOR_IP = "192.168.0.193";
export const DESK_RF_BONDED_UUID = "RINCON_804AF288FDBA01400";
