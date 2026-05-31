import { Icon } from "../Icon";
import { Skeleton, Stat, Tile, TileHeader } from "../ui";
import { TileStatus } from "./EventsTileView";
import { TeslaMap } from "./TeslaMap";

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
          data-charge-fill
          style={{
            width: `${pct}%`,
            height: "100%",
            // Green only while charging; gray + no glow when idle.
            background: charging
              ? "linear-gradient(90deg,var(--acc-2),var(--acc))"
              : "linear-gradient(90deg,var(--ink-3),var(--ink-2))",
            borderRadius: 7,
            boxShadow: charging ? "0 0 14px var(--acc-line)" : "none",
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

export const TeslaTileStatus = TileStatus;
export type TeslaTileStatus = TileStatus;

export type TeslaTileViewProps =
  | { status: typeof TileStatus.Loading }
  | { status: typeof TileStatus.Error }
  | {
      status: typeof TileStatus.Populated;
      locked: boolean;
      charging: boolean;
      rate: number;
      pct: number;
      range: number;
      odo: string;
      climate: number;
      lat: number | null;
      lon: number | null;
      place: string;
    };

// ── Pure view ────────────────────────────────────────────────────────────────

export function TeslaTileView(props: TeslaTileViewProps) {
  if (props.status !== TileStatus.Populated) return <TeslaSkeleton />;

  const { locked, charging, rate, pct, range, odo, climate, lat, lon, place } = props;

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
        <TeslaMap lat={lat} lon={lon} place={place} />
      </div>

      {/* charging bar */}
      <TeslaCharge charging={charging} rate={rate} pct={pct} />

      {/* stats row */}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 2 }}>
        <Stat label="Range" value={`${range} mi`} accent={charging} muted={!charging} />
        <Stat label="Odometer" value={odo} />
        <Stat label="Cabin" value={`${climate}°F`} />
      </div>
    </Tile>
  );
}
