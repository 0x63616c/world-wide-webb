/**
 * TileModalHost — renders the active tile's detail modal plus the floating
 * VariantSwitcher above it. Tapping a board tile sets `entry`; this opens that
 * tile's default variant and lets you swap between its designed variants live.
 *
 * The active variant renders its OWN <Modal> (title, chrome, sizing), so the
 * host renders exactly one variant at a time and floats the switcher over it.
 */

import { useState } from "react";
import { Modal, Skeleton } from "../../ui";
import type { TileModalEntry } from "./types";
import { VariantSwitcher } from "./VariantSwitcher";

export interface TileModalHostProps {
  entry: TileModalEntry | null;
  onClose: () => void;
}

export function TileModalHost({ entry, onClose }: TileModalHostProps) {
  if (!entry) return null;
  // Key by tileId so switching tiles fully remounts (fresh variant selection).
  return <ActiveTileModal key={entry.tileId} entry={entry} onClose={onClose} />;
}

function ActiveTileModal({ entry, onClose }: { entry: TileModalEntry; onClose: () => void }) {
  const { variants, loading } = entry.useVariants();
  const [slug, setSlug] = useState(entry.defaultSlug);

  // Closed-state placeholder while live data loads — never a fabricated modal.
  if (loading || variants.length === 0) {
    return (
      <Modal open onClose={onClose} title="Loading">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton w="40%" h={28} />
          <Skeleton w="100%" h={180} />
          <Skeleton w="100%" h={64} />
        </div>
      </Modal>
    );
  }

  const active = variants.find((v) => v.slug === slug) ?? variants[0];

  return (
    <>
      {active.render(true, onClose)}
      {variants.length > 1 && (
        <VariantSwitcher variants={variants} activeSlug={active.slug} onSelect={setSlug} />
      )}
    </>
  );
}
