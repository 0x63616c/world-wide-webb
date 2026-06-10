import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner and disables the button. The label MUST stay meaningful
   *  while loading (e.g. "Connecting…") — it's the accessible name. Setting
   *  loading the instant the button is pressed is the double-submit guard. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  loading,
  children,
  disabled,
  // Default to "submit" so a Button inside a <form> drives submit natively (the
  // design relies on this); callers pass type="button" for non-submit actions.
  type = "submit",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("wwb-btn", `wwb-btn-${variant}`)}
      disabled={loading || disabled}
      {...rest}
    >
      {loading && <span className="wwb-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
