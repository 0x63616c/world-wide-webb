import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fieldErrorId } from "./Field";
import { AlertIcon } from "./icons";

interface CheckboxRowProps {
  id: string;
  checked: boolean;
  error?: boolean;
  /** Validation message, rendered right-aligned at the end of the row (icon on
   *  the right), mirroring the field label-row error (CC-t6yr). */
  errorMessage?: string;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

export function CheckboxRow({
  id,
  checked,
  error,
  errorMessage,
  onChange,
  children,
}: CheckboxRowProps) {
  return (
    <div className="wwb-check-row">
      <input
        id={id}
        type="checkbox"
        className={cn("wwb-checkbox", error && "is-error")}
        checked={checked}
        aria-invalid={error || undefined}
        aria-describedby={errorMessage ? fieldErrorId(id) : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="wwb-check-label" htmlFor={id}>
        {children}
      </label>
      {/* Error shares the checkbox row, right-aligned with the alert icon on its
          right (CC-t6yr). Always rendered (role=alert only when populated) so
          toggling it never reflows the submit button below (CC-2nrj). */}
      <div
        className="wwb-error wwb-error-inline wwb-error-check"
        id={fieldErrorId(id)}
        role={errorMessage ? "alert" : undefined}
        aria-live="polite"
      >
        {errorMessage && (
          <>
            <span className="wwb-error-text">{errorMessage}</span>
            <AlertIcon />
          </>
        )}
      </div>
    </div>
  );
}
