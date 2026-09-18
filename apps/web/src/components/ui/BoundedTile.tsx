/**
 * BoundedTile , the error-recovery wrapper every mounted tile sits inside.
 *
 * Pairs QueryErrorResetBoundary with TileBoundary via `resetKey` so a recovered
 * query resets the boundary without unmounting the surrounding view or forcing a
 * full page reload: TileBoundary shows the fallback, tapping retry resets
 * react-query's error state AND bumps the key, which remounts just the subtree.
 *
 * Lifted out of Board.tsx (it was a private component there) once the phone view
 * needed the same wrapper , a tile that throws must degrade to the boundary
 * rather than taking the whole screen down, and that is true wherever the tile is
 * mounted, not just on the board.
 *
 * Imported by path, and deliberately NOT re-exported from ui/index.ts: that
 * barrel is the shared tile-author surface, and this is app plumbing that wraps
 * tiles from the outside. Both call sites take the direct path.
 */

import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { TileBoundary } from "./TileBoundary";

export function BoundedTile({ children }: { children: ReactNode }) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <TileBoundary
          resetKey={resetKey}
          onReset={() => {
            reset();
            setResetKey((k) => k + 1);
          }}
        >
          {children}
        </TileBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
