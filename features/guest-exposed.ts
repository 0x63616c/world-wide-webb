/**
 * The hand-owned guest-surface allowlist (Track C Q7). An app id appears here
 * ONLY via a deliberate, security-reviewed edit — the codegen validator
 * (scripts/apps-gen/validate.ts) fails if any collected app's `guestExposed`
 * flag disagrees with this list, so widening the guest surface can never be an
 * implicit flag flip. Empty until Task 5.1 exposes the guest-wifi canary.
 *
 * @public consumed by scripts/apps-gen.ts; the allowlist is authored here, not
 * generated.
 */
export const GUEST_EXPOSED: readonly string[] = [];
