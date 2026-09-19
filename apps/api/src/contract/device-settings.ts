/**
 * The PER-DEVICE settings CONTRACT , the vocabulary and bounds for preferences
 * that belong to one physical panel rather than the installation as a whole.
 *
 * Sibling of ./settings.ts, and bound by the same rule: ZERO imports, plain
 * literals only. It is re-exported through `packages/api`
 * (`@cc/api/device-settings`) and therefore lands in the browser bundle.
 *
 * Why a separate store rather than more fields on the settings singleton: the
 * settings row is global (id = "singleton") and every panel reads the same
 * one. A per-device preference (this repo's only current example is the
 * device name) is a property of a specific piece of hardware in a specific
 * room, not something every panel should share. A device-local web store
 * alone works but is invisible to the server and lost on reinstall. Keying on
 * `device_id` fixes both.
 */

// ─── bounds ───────────────────────────────────────────────────────────────────

/** Longest device name accepted server-side. The client truncates to this
 *  bound before pushing (see lib/device-name.ts), this is the enforcement
 *  point that truncation exists to avoid hitting. */
export const NAME_MAX_LENGTH = 60;
