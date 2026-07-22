/**
 * Field , standalone dumb presentational labeled-control wrapper.
 * Zero trpc/data/hook dependencies; all state driven by props. Wraps a single
 * form control with a label + optional leading icon + an error-message slot.
 * The label row always reserves its height (the error slot is always present,
 * `role=alert` only when populated) so toggling an error never reflows the
 * control below it. Ported from the captive-portal guest primitives, restyled
 * onto cc tokens.
 */

import type { ReactNode } from "react";

export interface FieldProps {
  /** Same id passed to the inner control, so the error message id derives as
   *  `${id}-error` and the control's aria-describedby points at it. */
  id: string;
  label: string;
  icon?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}

/** Derives the error-message element id for a field, so Field and its input
 *  agree on the aria-describedby target without prop threading. */
export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

export function Field({ id, label, icon, error, optional, children }: FieldProps) {
  return (
    <div>
      {/* Label + error share one row so toggling an error never reflows the
          control below (the error slot is always present, right-aligned, and
          truncates with an ellipsis). */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <label
          htmlFor={id}
          style={{
            fontFamily: "var(--ui)",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ink-2)",
            letterSpacing: "-0.01em",
          }}
        >
          {label}
          {optional && <span style={{ color: "var(--ink-3)", fontWeight: 400 }}> · optional</span>}
        </label>
        <div
          id={fieldErrorId(id)}
          role={error ? "alert" : undefined}
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minWidth: 0,
            color: "var(--red, #e5484d)",
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {error && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{error}</span>}
        </div>
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {icon && (
          <span
            style={{
              position: "absolute",
              left: 12,
              display: "flex",
              color: "var(--ink-3)",
              pointerEvents: "none",
            }}
          >
            {icon}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}
