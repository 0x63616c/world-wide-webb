import { TileStatus } from "@/components/ui/tile-status";

/**
 * The slice of a React Query / tRPC `useQuery` result a tile needs to resolve
 * its display status. Any `trpc.*.useQuery(...)` return value satisfies this
 * structurally, so a container hands the result straight in without adapting it.
 */
export interface TileQueryLike<TData> {
  // `TData` is the query result's `data` type verbatim (already `Result |
  // undefined`, and `| null` for procedures that yield null); the populated
  // variant strips those with NonNullable so a container never re-checks.
  data: TData;
  isError: boolean;
}

/**
 * Discriminated result: narrowing on `status === TileStatus.Populated` proves
 * `data` is present, so a container can pass `data` to the populated view with
 * no redundant guard.
 */
export type TileQueryResult<TData> =
  | { status: typeof TileStatus.Loading; data: undefined }
  | { status: typeof TileStatus.Error; data: undefined }
  // NonNullable: a query result's `data` is `T | undefined`, so `TData` infers
  // wide; stripping null/undefined here is what lets `status === Populated`
  // narrow `data` to a present value at the call site.
  | { status: typeof TileStatus.Populated; data: NonNullable<TData> };

/**
 * The one status rule every tile container shares (www-355t.13): show the error
 * state only when there is nothing to show. Precedence is data-first, so a poll
 * that fails while a previous snapshot is still cached keeps the tile Populated
 * on that stale data rather than flashing an error , a dead API degrades to
 * "last known good", never an infinite shimmer. `data` is compared with `!=`
 * so a query that yields `null` (e.g. controls when HA is unavailable) reads as
 * "no data yet", not populated.
 */
export function useTileQuery<TData>(query: TileQueryLike<TData>): TileQueryResult<TData> {
  if (query.data != null) return { status: TileStatus.Populated, data: query.data };
  if (query.isError) return { status: TileStatus.Error, data: undefined };
  return { status: TileStatus.Loading, data: undefined };
}
