// Re-export the api's AppRouter type for the web client. This is a type-only
// re-export: the web bundle never imports api runtime code, only its types.
export type { AppRouter } from "@control-center/api/trpc";
