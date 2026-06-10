import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CheckboxRowProps {
  id: string;
  checked: boolean;
  error?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

export function CheckboxRow({ id, checked, error, onChange, children }: CheckboxRowProps) {
  return (
    <div className="wwb-check-row">
      <input
        id={id}
        type="checkbox"
        className={cn("wwb-checkbox", error && "is-error")}
        checked={checked}
        aria-invalid={error || undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="wwb-check-label" htmlFor={id}>
        {children}
      </label>
    </div>
  );
}
