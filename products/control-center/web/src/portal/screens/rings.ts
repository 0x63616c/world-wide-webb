import type { CSSProperties } from "react";

// Shared icon-ring styles (ported from the source's .wwb-success-ring /
// .wwb-icon-ring classes): a circular badge behind the status icon on the
// terminal (non-form) screens. `successRing` reads positive (foreground
// tint); `neutralRing` is the muted variant for rate-limit/session/error.
export const successRing: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 56,
  height: 56,
  borderRadius: "50%",
  color: "var(--ink)",
  background: "rgba(255, 255, 255, 0.06)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  boxShadow: "0 0 0 6px rgba(255, 255, 255, 0.03)",
};

export const neutralRing: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 56,
  height: 56,
  borderRadius: "50%",
  color: "var(--ink-2)",
  background: "rgba(255, 255, 255, 0.05)",
  border: "1px solid rgba(255, 255, 255, 0.14)",
};
