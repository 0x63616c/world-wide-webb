const COLORS = ["bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-blue-400", "bg-neutral-600"];
const LABELS = ["P0", "P1", "P2", "P3", "P4"];

export function PriorityDot({ p }: { p: number }) {
  const color = COLORS[p] ?? COLORS[4];
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-xs text-neutral-500 font-mono">{LABELS[p] ?? "P?"}</span>
    </span>
  );
}
