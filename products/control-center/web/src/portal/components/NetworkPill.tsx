/** @public , unused by the 8 shipped screens (it belongs to the unshipped
 *  LandingSplit variant); ported 1:1 per the source, no "guest" copy. */
interface NetworkPillProps {
  /** Network label. Defaults to "Wi-Fi". The design's verbatim "Guest Wi-Fi"
   *  is intentionally NOT used: the PRD forbids the word "guest" in any
   *  user-facing copy (lead ruling), even on the unshipped LandingSplit
   *  variant where this pill appears. */
  label?: string;
}

export function NetworkPill({ label = "Wi-Fi" }: NetworkPillProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 24,
        padding: "0 10px",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        fontWeight: 500,
        letterSpacing: "0.01em",
        color: "var(--ink-2)",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid var(--hair)",
        borderRadius: 999,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--teal)",
          boxShadow: "0 0 0 3px rgba(111, 219, 203, 0.18)",
        }}
      />
      {label}
    </span>
  );
}
