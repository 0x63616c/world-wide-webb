// Pulumi program entry point for the control-center stack.
//
// FOUNDATION ONLY (www-j934.1): this milestone establishes the workspace, Cloud
// auth, and the ComponentResource vocabulary (src/) with unit tests. The actual
// per-environment resources (the cluster Provider + the Workloads for api, web,
// worker, …) are wired in www-j934.6. Keeping the program empty here means
// `pulumi preview` is a clean no-op and nothing touches prod before the
// adopt-only import milestones (CF re-home www-j934.2, UniFi www-j934.3) land.
//
// The vocabulary is exercised by infra/test/render.test.ts; import it from
// "./src/index.ts" in the environment stack programs that follow.

export {};
