// The lifecycle status of a tile's data: every tile's container resolves its
// query to one of these and hands it to the view. It lives in the ui primitive
// layer (not in any single tile) so tiles don't couple to EventsTileView just to
// share this enum (CC-355t.13).
export const TileStatus = {
  Loading: "loading",
  Error: "error",
  Populated: "populated",
} as const;
export type TileStatus = (typeof TileStatus)[keyof typeof TileStatus];
