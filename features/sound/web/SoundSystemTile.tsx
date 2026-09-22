/**
 * SoundSystemTile , container for the Sound System 4×3 tile (www-51hf.18 / A22).
 *
 * All data and mutations come from useSoundControls (shared with the full-page
 * detail view, so both surfaces agree on display volumes and the lock
 * semantics). Renders Skeleton while pending/error (A18).
 *
 * Tapping the tile opens the full-page Sound System detail via the board's
 * tile-detail registry (wired in web/wiring/sound.tsx).
 */

import { useSoundControls } from "./hooks/useSoundControls";
import { SoundSystemTileView } from "./SoundSystemTileView";

export function SoundSystemTile() {
  const c = useSoundControls();

  return (
    <SoundSystemTileView
      status={c.status}
      rooms={c.rooms}
      vols={c.vols}
      mutes={c.mutes}
      globalLock={c.globalLock}
      groupLock={c.groupLock}
      onFaderChange={c.setVolume}
      onStep={c.stepVolume}
      onToggleGlobalLock={() => c.setGlobalLock(!c.globalLock)}
      onToggleGroupLock={c.toggleGroupLock}
    />
  );
}
