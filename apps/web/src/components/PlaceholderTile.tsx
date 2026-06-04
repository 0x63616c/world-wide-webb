// An empty decorative tile: the standard tile background with no header, icon, or
// content. Used to populate the free world space around the real cluster so the
// pannable canvas reads as a fuller dashboard. Purely ambient — dimmed below the
// real tiles and non-interactive (the board renders it in a pointer-events:none
// layer), so it never intercepts taps or opens a modal.
export function PlaceholderTile() {
  return <div className="tile" style={{ height: "100%", opacity: 0.5 }} />;
}
