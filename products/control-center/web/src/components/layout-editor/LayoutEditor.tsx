/**
 * LayoutEditor , data wiring for the layout editor. Renders nothing while
 * closed (`useLayoutEditorOpen`); while open it stages a working copy of the
 * resolved layout, computes bento validity live, and drives `trpc.layout.save`
 * on Save. `LayoutEditorView` (the pure view) owns all camera/drag/rendering
 * concerns , this component only owns state + the network call.
 *
 * Staging is re-seeded from the resolved layout every time the editor
 * transitions from closed → open, so a fresh session always starts from
 * whatever is currently live (never a stale snapshot from a previous open).
 * The staged arrangement is never dropped on a failed save , the mutation
 * error surfaces inline and the editor stays open so the user can retry or
 * cancel explicitly.
 */
import { useEffect, useMemo, useState } from "react";
import { bentoFor } from "../../lib/placeholder-tiles";
import { TILE_REGISTRY } from "../../lib/tile-registry";
import { trpc } from "../../lib/trpc";
import { useBoardLayout } from "../../lib/useBoardLayout";
import { closeLayoutEditor, useLayoutEditorOpen } from "../../lib/layout-edit-store";
import { LayoutEditorView, type LayoutEditorTile } from "./LayoutEditorView";

const INVALID_REASON = "board can't fill around this arrangement";

function isDirty(staged: LayoutEditorTile[], original: LayoutEditorTile[]): boolean {
  if (staged.length !== original.length) return true;
  const byId = new Map(original.map((t) => [t.id, t]));
  return staged.some((t) => {
    const o = byId.get(t.id);
    return !o || o.worldCol !== t.worldCol || o.worldRow !== t.worldRow;
  });
}

export function LayoutEditor() {
  const open = useLayoutEditorOpen();
  const utils = trpc.useUtils();
  const { layout } = useBoardLayout();

  const [staged, setStaged] = useState<LayoutEditorTile[]>(layout.tiles);
  // The arrangement staging is compared against for `dirty` , reseeded
  // alongside `staged` whenever the editor (re)opens.
  const [baseline, setBaseline] = useState<LayoutEditorTile[]>(layout.tiles);

  // Re-seed from the current resolved layout on every closed→open transition,
  // never mid-session (a background poll must not clobber in-progress edits).
  useEffect(() => {
    if (!open) return;
    setStaged(layout.tiles);
    setBaseline(layout.tiles);
    // Only ever re-seed on the open transition itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const saveMutation = trpc.layout.save.useMutation({
    onSuccess: () => {
      utils.layout.get.invalidate();
      closeLayoutEditor();
    },
  });

  const valid = useMemo(() => {
    try {
      bentoFor(staged.map((t) => ({ col: t.worldCol, row: t.worldRow, cols: t.cols, rows: t.rows })));
      return true;
    } catch {
      return false;
    }
  }, [staged]);

  if (!open) return null;

  const dirty = isDirty(staged, baseline);

  const handleMove = (tileId: string, col: number, row: number) => {
    setStaged((ts) => ts.map((t) => (t.id === tileId ? { ...t, worldCol: col, worldRow: row } : t)));
  };

  const handleReset = () => {
    setStaged(TILE_REGISTRY.map((entry) => ({ ...entry })));
  };

  const handleCancel = () => {
    closeLayoutEditor();
  };

  const handleSave = () => {
    saveMutation.mutate({
      placements: staged.map((t) => ({ tileId: t.id, worldCol: t.worldCol, worldRow: t.worldRow })),
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      {saveMutation.isError ? (
        <div
          data-testid="layout-editor-save-error"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            padding: "8px 16px",
            borderRadius: 8,
            background: "var(--danger-bg, rgba(255,84,112,0.15))",
            border: "1px solid var(--danger, #ff5470)",
            color: "var(--ink, #e8edf2)",
            fontFamily: "var(--ui)",
            fontSize: 13,
          }}
        >
          {saveMutation.error?.message ?? "Save failed , try again."}
        </div>
      ) : null}
      <LayoutEditorView
        tiles={staged}
        renderTile={(entry) => {
          const Component = entry.component;
          return <Component />;
        }}
        onMove={handleMove}
        onReset={handleReset}
        onCancel={handleCancel}
        onSave={handleSave}
        saving={saveMutation.isPending}
        valid={valid}
        invalidReason={valid ? null : INVALID_REASON}
        dirty={dirty}
      />
    </div>
  );
}
