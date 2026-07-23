import { Icon } from "@/components/Icon";
import { Skeleton, Stat, Tile, TileHeader, TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { formatRelativeAge } from "@/lib/relative-age";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { TeslaMap } from "./tesla-map";

// ── Charging bar ─────────────────────────────────────────────────────────────

interface ChargeProps {
  charging: boolean;
  rate: number;
  pct: number;
  /** Non-null while the car sleeps: label for the Asleep pill ("Asleep · 2hrs"). */
  asleepLabel: string | null;
}

function TeslaCharge({ charging, rate, pct, asleepLabel }: ChargeProps) {
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
        {asleepLabel !== null ? (
          <span className="pill" style={{ padding: "4px 10px" }}>
            <Icon name="moon" s={14} />
            {asleepLabel}
          </span>
        ) : charging ? (
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
          background: "var(--nest)",
          overflow: "hidden",
          border: "1px solid var(--hair)",
        }}
      >
        <div
          data-charge-fill
          // Explicit state flag so tests can assert the charging/idle branch
          // robustly , the gradient itself uses CSS vars that a real browser
          // resolves to rgb (and jsdom drops), so the inline value isn't a
          // stable cross-environment assertion target.
          data-charging={charging ? "true" : "false"}
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
  // Mirrors the populated layout: real title up top, lock pill (data-driven)
  // shimmered to its ~25px pill footprint, then map / charge / stats shimmers.
  return (
    <Tile padding={22} style={{ gap: 16 }}>
      <TileHeader icon="car" title="Tesla" right={<Skeleton w={78} h={25} borderRadius={999} />} />
      <div style={{ flex: 1, minHeight: 140 }}>
        <Skeleton w="100%" h="100%" borderRadius={14} />
      </div>
      <Skeleton w="100%" h={32} borderRadius={8} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <Skeleton w="30%" h={40} borderRadius={6} />
        <Skeleton w="30%" h={40} borderRadius={6} />
        <Skeleton w="30%" h={40} borderRadius={6} />
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
      /** Car is asleep; every value shown is the last-known snapshot, dimmed. */
      asleep?: boolean;
      /** ISO timestamp of the snapshot the values came from; null when unknown. */
      updatedAt?: string | null;
    };

// ── Pure view ────────────────────────────────────────────────────────────────

export function TeslaTileView(props: TeslaTileViewProps) {
  if (props.status !== TileStatus.Populated) return <TeslaSkeleton />;

  const { locked, charging, rate, pct, range, odo, climate, lat, lon, place } = props;
  const asleep = props.asleep === true;
  // While asleep every value is a stale snapshot , suppress the live "charging"
  // treatment (green bar/accent) so stale data never reads as fresh activity.
  const chargingLive = charging && !asleep;
  const age =
    asleep && props.updatedAt ? formatRelativeAge(Date.parse(props.updatedAt), Date.now()) : null;
  const asleepLabel = asleep ? (age ? `Asleep · ${age}` : "Asleep") : null;

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

      {/* charge + stats , dimmed as a block while the snapshot is stale */}
      <div
        data-asleep={asleep ? "true" : undefined}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          opacity: asleep ? 0.55 : 1,
        }}
      >
        {/* charging bar */}
        <TeslaCharge charging={chargingLive} rate={rate} pct={pct} asleepLabel={asleepLabel} />

        {/* stats row */}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 2 }}>
          <Stat label="Range" value={`${range} mi`} accent={chargingLive} muted={!chargingLive} />
          <Stat label="Odometer" value={odo} />
          <Stat label="Cabin" value={`${climate}°F`} />
        </div>
      </div>
    </Tile>
  );
}

// ── Container ────────────────────────────────────────────────────────────────

export function TeslaTile() {
  const q = useTileQuery(
    trpc.tesla.get.useQuery(undefined, {
      refetchInterval: POLL.tesla,
    }),
  );

  if (q.status !== TileStatus.Populated) return <TeslaTileView status={q.status} />;

  const data = q.data;
  return (
    <TeslaTileView
      status={q.status}
      locked={data.locked}
      charging={data.charging}
      rate={data.rate}
      pct={data.pct}
      range={data.range}
      odo={data.odo}
      climate={data.climate}
      lat={data.lat ?? null}
      lon={data.lon ?? null}
      place={data.place ?? ""}
    />
  );
}
