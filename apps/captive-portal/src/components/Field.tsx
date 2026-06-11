import type { ReactNode } from "react";
import { AlertIcon } from "./icons";

interface FieldProps {
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
      {/* Label + error share one row (www-2nrj). The row always reserves its
          height: the error slot is always present (aria-live, role=alert only
          when populated), so toggling an error never reflows the inputs below.
          The error is right-aligned and truncates with an ellipsis. */}
      <div className="wwb-label-row">
        <label className="wwb-label" htmlFor={id}>
          {label}
          {optional && (
            <span style={{ color: "var(--faint-foreground)", fontWeight: 400 }}> · optional</span>
          )}
        </label>
        <div
          className="wwb-error wwb-error-inline"
          id={fieldErrorId(id)}
          role={error ? "alert" : undefined}
          aria-live="polite"
        >
          {error && (
            <>
              <AlertIcon />
              <span className="wwb-error-text">{error}</span>
            </>
          )}
        </div>
      </div>
      <div className="wwb-input-wrap">
        {icon && <span className="wwb-input-icon">{icon}</span>}
        {children}
      </div>
    </div>
  );
}
