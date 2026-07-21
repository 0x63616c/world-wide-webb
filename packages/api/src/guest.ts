// Re-export the api's GuestRouter type for the guest web client. This is a
// type-only re-export: the guest bundle never imports api runtime code, only
// its types (guest surface = portal only, ADR-0006).
export type { GuestRouter } from "@control-center/api/trpc-guest";
