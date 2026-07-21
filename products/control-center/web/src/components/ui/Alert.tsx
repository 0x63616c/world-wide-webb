/**
 * Alert , standalone dumb presentational inline destructive alert.
 * Zero trpc/data/hook dependencies; all state driven by props. This is the
 * only alert variant (a full success state is a whole screen, not a banner).
 * Sits at the top of the form it relates to; role=alert so it's announced.
 * Ported from the captive-portal guest primitives, restyled onto cc tokens.
 */

import type { ReactNode } from "react";
import { Icon } from "../Icon";

export interface AlertProps {
  title?: string;
  children: ReactNode;
}

export function Alert({ title, children }: AlertProps) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(229, 72, 77, 0.12)",
        border: "1px solid rgba(229, 72, 77, 0.4)",
        color: "var(--red, #e5484d)",
        fontFamily: "var(--ui)",
        fontSize: 13.5,
        letterSpacing: "-0.01em",
        lineHeight: 1.4,
      }}
    >
      <Icon name="alert" s={18} sw={1.8} />
      <div>
        {title && <strong style={{ fontWeight: 600 }}>{title}</strong>}
        {title && " "}
        {children}
      </div>
    </div>
  );
}
