import { Icon } from "../Icon";
import { Skeleton, Stat, Tile, TileHeader } from "../ui";

// ── Sub-components ──────────────────────────────────────────────────────────

// Lo-fi SVG map — purely decorative, no live data dependency.
// Ticket www-d3t will replace this with a real GPS map.
function TeslaMap() {
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid var(--hair)",
        background: "#0A0D10",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 400 260"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0 }}
        aria-hidden="true"
      >
        <rect width="400" height="260" fill="#0A0D10" />

        {/* city blocks */}
        <g fill="#0E1318">
          <rect x="34" y="26" width="120" height="78" rx="3" />
          <rect x="170" y="26" width="96" height="78" rx="3" />
          <rect x="282" y="26" width="96" height="78" rx="3" />
          <rect x="34" y="170" width="120" height="78" rx="3" />
          <rect x="170" y="170" width="96" height="78" rx="3" />
          <rect x="282" y="170" width="96" height="78" rx="3" />
        </g>

        {/* grid lines */}
        <g stroke="#171D23" strokeWidth="2.5" fill="none">
          <path d="M160 -10 V270 M272 -10 V270 M-10 116 H410" />
        </g>

        {/* a local street road */}
        <g stroke="#252E36" strokeWidth="8" fill="none" strokeLinecap="round">
          <path d="M-10 142 H410" />
        </g>
        <g stroke="#33414B" strokeWidth="1.6" strokeDasharray="7 9" fill="none">
          <path d="M-10 142 H410" />
        </g>

        {/* proximity ring */}
        <circle
          cx="200"
          cy="138"
          r="50"
          fill="rgba(91,227,125,.06)"
          stroke="rgba(91,227,125,.28)"
          strokeWidth="1.4"
          strokeDasharray="3 6"
        />

        {/* pin marker */}
        <g transform="translate(200,134)">
          <circle r="22" fill="rgba(91,227,125,.14)" />
          <path d="M0 16 C-9 5 -12 0 -12 -4 A12 12 0 1 1 12 -4 C12 0 9 5 0 16Z" fill="var(--acc)" />
          <circle cx="0" cy="-4" r="4.5" fill="#06210F" />
        </g>
      </svg>

      {/* street label */}
      <div style={{ position: "absolute", left: 12, top: 12 }} className="cap">
        a local street
      </div>

      {/* parked pill */}
      <span
        className="pill on"
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          padding: "4px 10px",
          fontSize: 12,
        }}
      >
        <span className="dot" />
        Parked · Home
      </span>
    </div>
  );
}

// ── Charging bar ─────────────────────────────────────────────────────────────

interface ChargeProps {
  charging: boolean;
  rate: number;
  pct: number;
}

function TeslaCharge({ charging, rate, pct }: ChargeProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 9,
        }}
      >
        {charging ? (
          <span className="pill on" style={{ padding: "4px 10px" }}>
            <Icon name="bolt" s={14} />
            Charging · +{rate} mi/hr
          </span>
        ) : (
          <span className="pill" style={{ padding: "4px 10px" }}>
            Idle
          </span>
        )}
        <span className="mono" style={{ fontSize: 17, fontWeight: 700 }}>
          {pct}%
        </span>
      </div>

      {/* gradient bar */}
      <div
        style={{
          height: 12,
          borderRadius: 7,
          background: "#15191E",
          overflow: "hidden",
          border: "1px solid var(--hair)",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg,var(--acc-2),var(--acc))",
            borderRadius: 7,
            boxShadow: "0 0 14px var(--acc-line)",
          }}
        />
      </div>
    </div>
  );
}

// ── Skeleton layout mirroring the real tile structure ────────────────────────

function TeslaSkeleton() {
  return (
    <Tile padding={22}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
        <Skeleton w="100%" h={38} borderRadius={11} />
        <div style={{ flex: 1, minHeight: 140 }}>
          <Skeleton w="100%" h="100%" borderRadius={14} />
        </div>
        <Skeleton w="100%" h={32} borderRadius={8} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Skeleton w="30%" h={40} borderRadius={6} />
          <Skeleton w="30%" h={40} borderRadius={6} />
          <Skeleton w="30%" h={40} borderRadius={6} />
        </div>
      </div>
    </Tile>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TeslaTileStatus = "loading" | "error" | "populated";

export type TeslaTileViewProps =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "populated";
      locked: boolean;
      charging: boolean;
      rate: number;
      pct: number;
      range: number;
      odo: string;
      climate: number;
    };

// ── Pure view ────────────────────────────────────────────────────────────────

export function TeslaTileView(props: TeslaTileViewProps) {
  if (props.status !== "populated") return <TeslaSkeleton />;

  const { locked, charging, rate, pct, range, odo, climate } = props;

  return (
    <Tile padding={22} style={{ gap: 16 }}>
      <TileHeader
        icon="car"
        title="Tesla"
        right={
          <span className={`pill${locked ? "" : " amber"}`}>
            <Icon name={locked ? "lock" : "unlock"} s={15} />
            {locked ? "Locked" : "Unlocked"}
          </span>
        }
      />

      {/* map */}
      <div style={{ flex: 1, minHeight: 140 }}>
        <TeslaMap />
      </div>

      {/* charging bar */}
      <TeslaCharge charging={charging} rate={rate} pct={pct} />

      {/* stats row */}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 2 }}>
        <Stat label="Range" value={`${range} mi`} accent />
        <Stat label="Odometer" value={odo} />
        <Stat label="Cabin" value={`${climate}°F`} />
      </div>
    </Tile>
  );
}
