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
      <label className="wwb-label" htmlFor={id}>
        {label}
        {optional && (
          <span style={{ color: "var(--faint-foreground)", fontWeight: 400 }}> · optional</span>
        )}
      </label>
      <div className="wwb-input-wrap">
        {icon && <span className="wwb-input-icon">{icon}</span>}
        {children}
      </div>
      {error && (
        <div className="wwb-error" role="alert" id={fieldErrorId(id)}>
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
