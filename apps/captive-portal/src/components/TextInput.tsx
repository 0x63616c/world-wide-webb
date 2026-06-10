import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { fieldErrorId } from "./Field";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id?: string;
  /** Adds left padding for a leading icon (matches Field's icon slot). */
  icon?: boolean;
  /** When set, applies error styling AND the a11y attributes: aria-invalid plus
   *  aria-describedby pointing at the Field's error message (`${id}-error`). */
  error?: boolean;
}

export function TextInput({ id, type = "text", icon, error, ...rest }: TextInputProps) {
  return (
    <input
      id={id}
      type={type}
      className={cn("wwb-input", icon && "has-icon", error && "is-error")}
      aria-invalid={error || undefined}
      aria-describedby={error && id ? fieldErrorId(id) : undefined}
      {...rest}
    />
  );
}
