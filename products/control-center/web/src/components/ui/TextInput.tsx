/**
 * TextInput , standalone dumb presentational single-line text field.
 * Zero trpc/data/hook dependencies; all state driven by props. Styled to match
 * the logs viewer's search input so text controls read as one family. The
 * `label` is the accessible name , the control has no visible text of its own
 * unless an external <label htmlFor={id}> (e.g. `Field`) supplies it, in which
 * case `label` still doubles as `aria-label` (same string, harmless).
 */

import type { CSSProperties } from "react";
import { fieldErrorId } from "./Field";

export interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Accessible name , the control has no visible text of its own. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Same id a wrapping `Field` passes its `<label htmlFor>`; also derives the
   *  `aria-describedby` target for `error`. */
  id?: string;
  /** HTML input type, e.g. "password" for masked entry. */
  type?: "text" | "password";
  /** Reserves left padding for a leading icon (matches Field's icon slot). */
  icon?: boolean;
  /** Applies error styling plus aria-invalid/aria-describedby (pointing at
   *  the Field's error message, `${id}-error`). */
  error?: boolean;
  autoComplete?: string;
  style?: CSSProperties;
}

export function TextInput({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  id,
  type = "text",
  icon,
  error,
  autoComplete,
  style,
}: TextInputProps) {
  return (
    <input
      id={id}
      type={type}
      aria-label={label}
      aria-invalid={error || undefined}
      aria-describedby={error && id ? fieldErrorId(id) : undefined}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 36,
        padding: icon ? "0 12px 0 38px" : "0 12px",
        margin: 0,
        background: "var(--nest)",
        border: `1px solid ${error ? "var(--red, #e5484d)" : "var(--hair)"}`,
        borderRadius: 10,
        color: "var(--ink-1)",
        fontFamily: "var(--ui)",
        fontSize: 14,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "text",
        ...style,
      }}
    />
  );
}
