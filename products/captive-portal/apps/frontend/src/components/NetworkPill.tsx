interface NetworkPillProps {
  /** Network label. Defaults to "Wi-Fi". The design's verbatim "Guest Wi-Fi"
   *  is intentionally NOT used: the PRD forbids the word "guest" in any
   *  user-facing copy (lead ruling), even on the unshipped LandingSplit
   *  variant where this pill appears. */
  label?: string;
}

export function NetworkPill({ label = "Wi-Fi" }: NetworkPillProps) {
  return (
    <span className="wwb-pill">
      <span className="dot" />
      {label}
    </span>
  );
}
