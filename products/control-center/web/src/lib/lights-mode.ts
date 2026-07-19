/**
 * Lights quick-control mode cycle , pure helpers (no React/trpc).
 *
 * The "Lights" control drives TWO independent fixtures: `kitchen` (the under-
 * cabinet strip) and `overhead` (the living-room overhead switch). Instead of a
 * binary on/off it is a 4-state cycle; each tap advances to the next mode and
 * wraps around:
 *
 *   OFF (both off) → K ON (kitchen only) → O ON (overhead only) → ON (both) → OFF
 *
 * | Mode      | kitchen | overhead | label  |
 * |-----------|---------|----------|--------|
 * | off       | off     | off      | `OFF`  |
 * | kitchen   | ON      | off      | `K ON` |
 * | overhead  | off     | ON       | `O ON` |
 * | on        | ON      | ON       | `ON`   |
 *
 * Because each fixture is a single boolean, the four modes are a TOTAL bijection
 * over {kitchen, overhead}: every live state maps to exactly one canonical mode
 * (an unreachable fixture reads as off, honestly). There is therefore no genuinely
 * ambiguous "in-between" state to resolve , `deriveLightsMode` is total. The only
 * fallback is the defensive one in `nextLightsMode`, which starts the cycle at OFF
 * if ever handed an unrecognised mode string.
 */

export const LightsMode = {
  Off: "off",
  Kitchen: "kitchen",
  Overhead: "overhead",
  On: "on",
} as const;
export type LightsMode = (typeof LightsMode)[keyof typeof LightsMode];

/** The on/off state of the two Lights fixtures. */
export interface LightsFixtures {
  kitchen: boolean;
  overhead: boolean;
}

/** Tap order: OFF → K ON → O ON → ON → OFF → … */
const CYCLE: readonly LightsMode[] = [
  LightsMode.Off,
  LightsMode.Kitchen,
  LightsMode.Overhead,
  LightsMode.On,
];

const FIXTURES_BY_MODE: Record<LightsMode, LightsFixtures> = {
  [LightsMode.Off]: { kitchen: false, overhead: false },
  [LightsMode.Kitchen]: { kitchen: true, overhead: false },
  [LightsMode.Overhead]: { kitchen: false, overhead: true },
  [LightsMode.On]: { kitchen: true, overhead: true },
};

const LABEL_BY_MODE: Record<LightsMode, string> = {
  [LightsMode.Off]: "OFF",
  [LightsMode.Kitchen]: "K ON",
  [LightsMode.Overhead]: "O ON",
  [LightsMode.On]: "ON",
};

/** Derive the current mode from the two fixtures' on/off state. Total. */
export function deriveLightsMode({ kitchen, overhead }: LightsFixtures): LightsMode {
  if (kitchen && overhead) return LightsMode.On;
  if (kitchen) return LightsMode.Kitchen;
  if (overhead) return LightsMode.Overhead;
  return LightsMode.Off;
}

/** The {kitchen, overhead} desired state for a mode. */
export function lightsModeToFixtures(mode: LightsMode): LightsFixtures {
  return FIXTURES_BY_MODE[mode];
}

/**
 * The next mode in the cycle (wraps around). Defensive: an unrecognised mode
 * starts the cycle at OFF so the next tap is deterministic. Since
 * `deriveLightsMode` is total this fallback is never hit in practice.
 */
export function nextLightsMode(mode: LightsMode): LightsMode {
  const i = CYCLE.indexOf(mode);
  if (i === -1) return LightsMode.Off;
  return CYCLE[(i + 1) % CYCLE.length];
}

/** The button label for a mode: `OFF` / `K ON` / `O ON` / `ON`. */
export function lightsModeLabel(mode: LightsMode): string {
  return LABEL_BY_MODE[mode];
}
