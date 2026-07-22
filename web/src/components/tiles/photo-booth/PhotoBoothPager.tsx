/**
 * PhotoBoothPager , the fullscreen photo-booth page: the camera ⇄ gallery
 * navigation the detail host mounts for tile_booth. Camera is the landing view
 * (full-bleed); its bottom-left gallery button crosses to the gallery, whose
 * back arrow returns to the camera. The camera's top-left close leaves the whole
 * feature (back to the board) via `onClose`.
 *
 * Presentational , the gallery's live data arrives as props (the `photo-booth`
 * detail wiring runs `boothPhotos.list` and passes groups + a `photoUrl`
 * builder, exactly as the Activity wiring feeds its page), so Storybook can tap
 * through the whole flow with fixtures and no backend.
 */

import { useState } from "react";
import { BoothCamera } from "./BoothCamera";
import { BoothGallery, type BoothGroup } from "./BoothGallery";

export interface PhotoBoothPagerProps {
  /** Capture groups for the gallery, newest-first (from boothPhotos.list). */
  groups: BoothGroup[];
  /** Maps a listing path to a fetchable URL (the /media/booth-photos/ route). */
  photoUrl: (path: string) => string;
  /** Reversibly remove a whole capture (fires boothPhotos.remove). */
  onRemove: (groupId: string) => void;
  /** Leave the feature , closes the detail page back to the board. */
  onClose: () => void;
  /** Fired once a shot's uploads land, so the host can refresh the listing. */
  onCaptured?: () => void;
}

type View = "camera" | "gallery";

export function PhotoBoothPager({
  groups,
  photoUrl,
  onRemove,
  onClose,
  onCaptured,
}: PhotoBoothPagerProps) {
  const [view, setView] = useState<View>("camera");

  if (view === "gallery") {
    return (
      <BoothGallery
        groups={groups}
        photoUrl={photoUrl}
        onRemove={onRemove}
        onBack={() => setView("camera")}
      />
    );
  }

  return (
    <BoothCamera
      onOpenGallery={() => setView("gallery")}
      onClose={onClose}
      onCaptured={onCaptured}
    />
  );
}
