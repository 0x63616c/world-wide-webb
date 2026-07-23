import { featureGuestRouter } from "@features/_generated/guest-router.gen";

// Structural security boundary (ADR-0006): unauthenticated LAN guests are
// served exactly this router. It is the generated aggregate of every feature
// that is BOTH `guestExposed` in its manifest AND present in the hand-owned
// GUEST_EXPOSED allowlist (features/guest-exposed.ts) — today that is only
// guest-wifi's `portal` facet, so the guest surface is portal.* and nothing
// else. Widening it is a deliberate, security-reviewed allowlist edit that the
// codegen validator enforces; it can never be an implicit flag flip.
export const guestRouter = featureGuestRouter;

export type GuestRouter = typeof guestRouter;
