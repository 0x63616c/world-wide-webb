/**
 * ControlsTileView — pure presentational layer for the Controls tile.
 * All data and callbacks come in as props; no trpc or hooks inside.
 */

import { Icon } from "../Icon";
import { Skeleton, Tile, TileHeader } from "../ui";

// ─── types ────────────────────────────────────────────────────────────────────

export type ControlKey = "lamps" | "lights" | "fan";

export interface ControlEntry {
  on: boolean;
  sub?: string;
  pending?: boolean;
}

export interface ControlsViewData {
  lamps: ControlEntry;
  lights: ControlEntry;
  fan: ControlEntry;
}

export type ControlsTileViewProps =
  | { status: "loading" }
  | {
      status: "populated";
      data: ControlsViewData;
      onToggle: (key: ControlKey, currentOn: boolean) => void;
    };

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
        {icon === "fan" ? (
          <span
            data-fan-spin=""
            style={{
              display: "inline-flex",
              animation: "spin 10s linear infinite",
              animationPlayState: on ? "running" : "paused",
            }}
          >
            <Icon name="fan" s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
          </span>
        ) : (
          <Icon name={icon} s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
        )}
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

// ─── ControlsGridView — renders real tap cells ────────────────────────────────

interface ControlsGridViewProps {
  data: ControlsViewData;
  onToggle: (key: ControlKey, currentOn: boolean) => void;
}

export function ControlsGridView({ data, onToggle }: ControlsGridViewProps) {
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

      {/* Scene placeholder — future scene trigger */}
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
        aria-label="Scene"
      >
        <Icon name="plus" s={22} c="var(--ink-3)" />
        <span style={{ fontSize: 13 }}>Scene</span>
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

// ─── ControlsTileView — pure view ─────────────────────────────────────────────

export function ControlsTileView(props: ControlsTileViewProps) {
  return (
    <Tile padding={22}>
      <TileHeader icon="bulb" title="Controls" />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 13,
        }}
      >
        {props.status === "populated" ? (
          <ControlsGridView data={props.data} onToggle={props.onToggle} />
        ) : (
          <SkeletonGrid />
        )}
      </div>
    </Tile>
  );
}
