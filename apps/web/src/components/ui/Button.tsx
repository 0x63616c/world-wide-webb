/**
 * Button , standalone dumb presentational button.
 * Zero trpc/data/hook dependencies; all state driven by props. Two variants:
 * `primary` (accent-filled, the main action) and `ghost` (bordered, secondary
 * actions). Ported from the captive-portal guest primitives, restyled onto cc
 * tokens.
 */

import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";

type ButtonVariant = "primary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner and disables the button. The label MUST stay meaningful
   *  while loading (e.g. "Connecting…"), it's the accessible name. Setting
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
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const isDisabled = loading || disabled;
  const primary = variant === "primary";

  return (
    <button
      type={type}
      disabled={isDisabled}
      onMouseEnter={(e) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHover(false);
        onMouseLeave?.(e);
      }}
      style={{
        width: "100%",
        height: 42,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "0 16px",
        borderRadius: 10,
        border: primary
          ? "1px solid transparent"
          : `1px solid ${hover ? "var(--hair-3)" : "var(--hair-2)"}`,
        background: primary
          ? hover
            ? "var(--acc-2)"
            : "var(--acc)"
          : hover
            ? "var(--nest)"
            : "transparent",
        color: primary ? "var(--bg)" : "var(--ink)",
        fontFamily: "var(--ui)",
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        cursor: isDisabled ? "default" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
        transition: "background 0.15s ease, border-color 0.15s ease",
        ...style,
      }}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `2px solid ${primary ? "rgba(0,0,0,0.25)" : "var(--hair-2)"}`,
            borderTopColor: primary ? "var(--bg)" : "var(--ink)",
            animation: "spin 0.7s linear infinite",
          }}
        />
      )}
      {children}
    </button>
  );
}
