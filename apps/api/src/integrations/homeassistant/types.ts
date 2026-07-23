// Re-export the HA edge contract from `@www/core` so existing api consumers keep
// importing from `../integrations/homeassistant/types` unchanged (Track C hoist).

export type { HaEntity } from "@www/core";
export { HaError } from "@www/core";
