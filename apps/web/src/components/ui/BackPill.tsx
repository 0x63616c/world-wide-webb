import { useBackNavigation } from "../../lib/useBackNavigation";
import { Icon } from "../Icon";

/** Keep inside the surface's stacking context so dialogs cover the page below. */
export function BackPill({
  onBack,
  label = "Back to board",
}: {
  onBack: () => void;
  label?: string;
}) {
  useBackNavigation(onBack);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onBack();
      }}
      style={{
        position: "fixed",
        left: "calc(24px + env(safe-area-inset-left, 0px))",
        bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
        zIndex: 120,
        minHeight: 56,
        minWidth: 156,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "12px 20px",
        borderRadius: 999,
        border: "1px solid var(--hair-2)",
        background: "var(--ink)",
        color: "var(--bg)",
        fontFamily: "var(--ui)",
        fontSize: 18,
        fontWeight: 600,
        cursor: "pointer",
        pointerEvents: "auto",
      }}
    >
      <span aria-hidden="true" style={{ display: "flex", transform: "rotate(180deg)" }}>
        <Icon name="chevron" s={24} />
      </span>
      {label}
    </button>
  );
}
