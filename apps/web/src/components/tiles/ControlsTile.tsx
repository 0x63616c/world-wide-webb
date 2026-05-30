/**
 * Controls tile — lamps, ceiling lights, fan + "More" placeholder.
 * Ported from the ETap / ctrl cell in evee-tiles.jsx / Evee Dashboard.html.
 *
 * Data: trpc.controls.list (refetch 30s idle, 2s while any control is pending).
 * Mutations: trpc.controls.toggle — backend owns correctness, no client-side cache manipulation.
 */

import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";
import { Skeleton } from "../ui/Skeleton";

// ─── types ────────────────────────────────────────────────────────────────────

type ControlsData = NonNullable<RouterOutputs["controls"]["list"]>;
type ControlKey = "lamps" | "lights" | "fan";

// ─── adaptive refetch interval ────────────────────────────────────────────────

// React Query passes the full Query object; we only care about its state data.
function refetchInterval(query: { state: { data?: RouterOutputs["controls"]["list"] } }): number {
  const data = query.state?.data;
  if (!data) return 30_000;
  const anyPending = data.lamps.pending || data.lights.pending || data.fan.pending;
  return anyPending ? 2_000 : 30_000;
}

// ─── ETap — single control button ─────────────────────────────────────────────

interface TapProps {
  icon: "lamp" | "bulb" | "fan";
  label: string;
  on: boolean;
  sub?: string;
  pending?: boolean;
  onToggle: () => void;
}

function ETap({ icon, label, on, sub, pending, onToggle }: TapProps) {
  return (
    <button
      type="button"
      className={`tap${on ? " on" : ""}`}
      onClick={onToggle}
      data-pending={pending ? "true" : undefined}
      style={{
        padding: 17,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        background: "none",
        opacity: pending ? 0.7 : 1,
      }}
      aria-pressed={on}
      aria-label={label}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Icon name={icon} s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
        <span className="sd" />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 500 }}>{label}</div>
        <div
          className="mono"
          style={{
            fontSize: 12,
            color: on ? "var(--acc)" : "var(--ink-3)",
            marginTop: 4,
            textTransform: "uppercase",
            letterSpacing: ".08em",
          }}
        >
          {pending ? "…" : on ? (sub ?? "On") : "Off"}
        </div>
      </div>
    </button>
  );
}

// ─── ControlsTile ─────────────────────────────────────────────────────────────

export function ControlsTile() {
  const { data } = trpc.controls.list.useQuery({}, { refetchInterval });

  const toggleMutation = trpc.controls.toggle.useMutation();

  function handleToggle(key: ControlKey, currentOn: boolean) {
    toggleMutation.mutate({ key, on: !currentOn });
  }

  return (
    <div
      className="tile"
      style={{
        height: "100%",
        padding: 20,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Icon name="bulb" s={19} c="var(--ink-2)" />
        <span
          style={{
            fontSize: 17.5,
            fontWeight: 600,
            letterSpacing: "-.015em",
            whiteSpace: "nowrap",
          }}
        >
          Controls
        </span>
      </div>

      {/* 2×2 grid */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 13,
        }}
      >
        {data ? <ControlsGrid data={data} onToggle={handleToggle} /> : <SkeletonGrid />}
      </div>
    </div>
  );
}

// ─── ControlsGrid — renders real tap cells ────────────────────────────────────

interface ControlsGridProps {
  data: ControlsData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
}

function ControlsGrid({ data, onToggle }: ControlsGridProps) {
  return (
    <>
      <ETap
        icon="lamp"
        label="Lamps"
        on={data.lamps.on}
        sub={data.lamps.sub}
        pending={data.lamps.pending}
        onToggle={() => onToggle("lamps", data.lamps.on)}
      />

      <ETap
        icon="bulb"
        label="Lights"
        on={data.lights.on}
        pending={data.lights.pending}
        onToggle={() => onToggle("lights", data.lights.on)}
      />

      <ETap
        icon="fan"
        label="Fan"
        on={data.fan.on}
        sub={data.fan.sub}
        pending={data.fan.pending}
        onToggle={() => onToggle("fan", data.fan.on)}
      />

      {/* More — dashed placeholder */}
      <button
        type="button"
        style={{
          borderRadius: 15,
          border: "1.5px dashed var(--hair-2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--ink-3)",
          cursor: "pointer",
          font: "inherit",
          background: "none",
        }}
        aria-label="More controls"
      >
        <Icon name="plus" s={22} c="var(--ink-3)" />
        <span style={{ fontSize: 13 }}>More</span>
      </button>
    </>
  );
}

// ─── SkeletonGrid — shimmer placeholders while data loads ─────────────────────

function SkeletonGrid() {
  return (
    <>
      <Skeleton w="100%" h={80} borderRadius={15} />
      <Skeleton w="100%" h={80} borderRadius={15} />
      <Skeleton w="100%" h={80} borderRadius={15} />
      <Skeleton w="100%" h={80} borderRadius={15} />
    </>
  );
}
