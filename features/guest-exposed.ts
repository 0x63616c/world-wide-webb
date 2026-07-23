/**
 * The hand-owned guest-surface allowlist (Track C Q7). An app id appears here
 * ONLY via a deliberate, security-reviewed edit — the codegen validator
 * (scripts/apps-gen/validate.ts) fails if any collected app's `guestExposed`
 * flag disagrees with this list, so widening the guest surface can never be an
 * implicit flag flip.
 *
 * SECURITY BOUNDARY (ADR-0006): every id here is reachable by unauthenticated
 * guests on the LAN captive portal. Adding an id widens the guest attack surface
 * — it must be a deliberate, security-reviewed edit. The codegen validator throws
 * if any manifest's guestExposed flag disagrees with this list.
 *
 * @public consumed by scripts/apps-gen.ts; the allowlist is authored here, not
 * generated.
 */
export const GUEST_EXPOSED: readonly string[] = ["tile_guestwifi"];
