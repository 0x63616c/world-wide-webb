/**
 * ControlOverflow — secondary action panel for a control cell.
 * Appears as an in-tile overlay; primary toggle stays on the ControlTap button.
 */

export interface ControlOverflowProps {
  label: string;
  open: boolean;
  onClose: () => void;
  onRename: () => void;
  onScene: () => void;
}

export function ControlOverflow({ label, open, onClose, onRename, onScene }: ControlOverflowProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={`${label} options`}
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 20,
        background: "var(--bg-2)",
        display: "flex",
        flexDirection: "column",
        padding: 20,
        gap: 12,
        zIndex: 10,
      }}
    >
      {/* Label heading identifies which control this overflow belongs to */}
      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--ink-1)",
          marginBottom: 4,
        }}
      >
        {label}
      </span>

      <button
        type="button"
        aria-label="Rename"
        onClick={onRename}
        style={{
          padding: "12px 16px",
          borderRadius: 12,
          border: "none",
          background: "var(--bg-3)",
          color: "var(--ink-1)",
          font: "inherit",
          fontSize: 15,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        Rename
      </button>

      <button
        type="button"
        aria-label="Scene"
        onClick={onScene}
        style={{
          padding: "12px 16px",
          borderRadius: 12,
          border: "none",
          background: "var(--bg-3)",
          color: "var(--ink-1)",
          font: "inherit",
          fontSize: 15,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        Scene
      </button>

      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          marginTop: "auto",
          padding: "10px 16px",
          borderRadius: 12,
          border: "none",
          background: "none",
          color: "var(--ink-3)",
          font: "inherit",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}
