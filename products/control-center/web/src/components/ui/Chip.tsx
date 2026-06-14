import type { ReactNode } from "react";

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button type="button" className={`chip${active ? " on" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
