import type { ReactNode } from "react";
import { AlertIcon } from "./icons";

interface AlertProps {
  title?: string;
  children: ReactNode;
}

/** Inline destructive alert — the only alert variant (success is a whole
 *  screen, per the design). Sits at the top of the form it relates to. */
export function Alert({ title, children }: AlertProps) {
  return (
    <div className="wwb-alert wwb-alert-error" role="alert">
      <AlertIcon />
      <div>
        {title && <strong>{title}</strong>}
        {title && " "}
        {children}
      </div>
    </div>
  );
}
