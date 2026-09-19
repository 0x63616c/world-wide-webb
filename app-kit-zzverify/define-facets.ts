import type { Worker } from "@www/worker-runtime";

export const API_FACET_BRAND = Symbol.for("app-kit.api");
export const HTTP_FACET_BRAND = Symbol.for("app-kit.http");
export const TILE_VIEWS_FACET_BRAND = Symbol.for("app-kit.tile-views");
export const WORKER_CYCLES_FACET_BRAND = Symbol.for("app-kit.worker-cycles");

export type { Worker };

/** The minimum Tile View declaration codegen needs to enforce App ownership. */
export interface TileViewDeclaration {
  readonly tileId: string;
  /** Access belongs to the owning App manifest, never the detail facet. */
  readonly sensitive?: never;
  readonly private?: never;
  readonly access?: never;
}

/**
 * One raw (non-tRPC) HTTP route (S3). `handler` mirrors apps/api's `handle()`
 * shape exactly , raw bytes in via `req.arrayBuffer()`, a streamed/JSON
 * `Response` out, no tRPC context. CORS is overlaid centrally by the server
 * iterator (do NOT set CORS headers in the handler). `Request`/`Response`/`URL`
 * resolve here because the root tsconfig sets no `lib`, so TypeScript's
 * default DOM lib (implied by `target: ES2022`) is in scope at typecheck.
 */
export interface HttpRoute {
  /** Undefined = any method. Compared case-sensitively against `req.method`. */
  method?: string;
  /** Exact pathname (match "exact") or pathname prefix (match "prefix"). */
  path: string;
  /** Defaults to "exact". */
  match?: "exact" | "prefix";
  handler: (req: Request, url: URL) => Promise<Response>;
}

export function defineApi<T>(router: T): T {
  return brand(router, API_FACET_BRAND);
}
export function defineHttp(routes: HttpRoute[]): HttpRoute[] {
  return brand(routes, HTTP_FACET_BRAND);
}
export function defineTileViews<T extends TileViewDeclaration>(tileViews: T[]): T[] {
  return brand(tileViews, TILE_VIEWS_FACET_BRAND);
}
export function defineWorkerCycles<T extends Worker>(cycles: T[]): T[] {
  return brand(cycles, WORKER_CYCLES_FACET_BRAND);
}

function brand<T>(v: T, sym: symbol): T {
  Object.defineProperty(v as object, sym, { value: true, enumerable: false });
  return v;
}
