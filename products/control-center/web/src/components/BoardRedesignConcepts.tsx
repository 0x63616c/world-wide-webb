/**
 * BoardRedesignConcepts , three 1366x1024 board (dashboard) redesign concepts.
 * PROTOTYPE: static mock tiles on placeholder local state , no trpc, no pan
 * engine, no real tile components. One direction wins; the losers get deleted.
 *
 *  A , Chrome refresh: today's scattered-tile feel, but every tile gets the
 *      settings language: tinted icon chip + mono uppercase header, quieter
 *      hairlines, consistent padding.
 *  B , Hub dock: refreshed tiles plus a persistent bottom dock of hub
 *      launchers (Climate / Media / Tesla / Weather / Settings) and status.
 *  C , Domain clusters: the board reorganized into labeled cluster regions
 *      (SectionCard applied at board scale): Media / Climate / House / System.
 */

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { Pill, PillTone } from "./ui";

// ─── shared frame + mock tile chrome ────────────────────────────────────────

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="e-root"
      style={{
        width: 1366,
        height: 1024,
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

const MONO: CSSProperties = { fontFamily: "var(--mono)", color: "var(--ink)" };

function ChipIcon({ icon, tint, s = 26 }: { icon: IconName; tint: string; s?: number }) {
  return (
    <span
      style={{
        width: s,
        height: s,
        borderRadius: Math.round(s * 0.3),
        background: tint,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={icon} s={Math.round(s * 0.58)} sw={2} />
    </span>
  );
}

/** Refreshed tile chrome: tinted chip + mono uppercase label + optional right slot. */
function MockTile({
  icon,
  tint,
  label,
  right,
  children,
  style,
}: {
  icon: IconName;
  tint: string;
  label: string;
  right?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--tile)",
        border: "1px solid var(--hair)",
        borderRadius: 16,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflow: "hidden",
        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.035)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <ChipIcon icon={icon} tint={tint} />
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: "var(--ink-3)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span style={{ marginLeft: "auto" }}>{right}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

function BigValue({ value, unit, sub }: { value: string; unit?: string; sub?: string }) {
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...MONO, fontSize: 34, lineHeight: 1, letterSpacing: "-0.03em" }}>
          {value}
        </span>
        {unit ? <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{unit}</span> : null}
      </span>
      {sub ? <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{sub}</span> : null}
    </div>
  );
}

/** Tiny lamp/scene tap used by the Controls mock; local toggle state only. */
function TapCell({
  icon,
  label,
  initialOn,
}: {
  icon: IconName;
  label: string;
  initialOn?: boolean;
}) {
  const [on, setOn] = useState(initialOn ?? false);
  return (
    <button
      type="button"
      className={`tap${on ? " on" : ""}`}
      onClick={() => setOn(!on)}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        padding: "10px 12px",
        color: on ? "var(--acc)" : "var(--ink-2)",
        fontFamily: "var(--ui)",
        fontSize: 12.5,
      }}
    >
      <Icon name={icon} s={18} sw={2} />
      <span style={{ color: on ? "var(--ink)" : "var(--ink-2)" }}>{label}</span>
    </button>
  );
}

function CamFeed() {
  return (
    <div className="sketch" style={{ flex: 1, minHeight: 0 }}>
      <div className="scan" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
        }}
      >
        <Icon name="cam" s={28} sw={1.6} />
      </div>
      <span
        style={{
          position: "absolute",
          left: 10,
          bottom: 8,
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-2)",
          zIndex: 4,
        }}
      >
        LIVE · LIVING ROOM
      </span>
    </div>
  );
}

// Palette shared with the settings sidebar tints.
const T = {
  gray: "#8e8e93",
  amber: "#e0a83c",
  blue: "#4a90d9",
  green: "#43a56c",
  red: "#c95c5c",
  purple: "#9a6ad4",
  teal: "#3aa9a0",
};

// ─── Concept A , Chrome refresh (same board feel, new tile language) ───────

export function BoardConceptChromeRefresh() {
  return (
    <Frame>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gridTemplateRows: "repeat(4, 1fr)",
          gap: 14,
          padding: 18,
        }}
      >
        {/* Clock hero spans 2x2 */}
        <div
          style={{
            gridColumn: "2 / span 2",
            gridRow: "2 / span 2",
            background: "var(--tile)",
            border: "1px solid var(--hair-2)",
            borderRadius: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <span style={{ ...MONO, fontSize: 110, lineHeight: 1, letterSpacing: "-0.05em" }}>
            14:32
          </span>
          <span style={{ fontSize: 16, color: "var(--ink-2)" }}>
            Friday afternoon · sunny outside
          </span>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Pill>Outside 81°</Pill>
            <Pill tone={PillTone.On}>House cooling</Pill>
          </div>
        </div>

        <MockTile icon="cloud-sun" tint={T.amber} label="Weather Now" right={<Pill>Sunny</Pill>}>
          <BigValue value="74°" sub="feels 76° · wind 6 mph" />
        </MockTile>
        <MockTile
          icon="thermo"
          tint={T.teal}
          label="Climate · A/C"
          right={<Pill tone={PillTone.On}>Cooling</Pill>}
        >
          <BigValue value="72°" unit="set" sub="ambient 74° · 46% rh" />
        </MockTile>
        <MockTile icon="sun" tint={T.amber} label="Next 12 Hours">
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              height: 46,
            }}
          >
            {[
              { hour: "15", pct: 38 },
              { hour: "16", pct: 52 },
              { hour: "17", pct: 64, peak: true },
              { hour: "18", pct: 70, peak: true },
              { hour: "19", pct: 66 },
              { hour: "20", pct: 54 },
              { hour: "21", pct: 44 },
              { hour: "22", pct: 40 },
            ].map((h) => (
              <span
                key={h.hour}
                style={{
                  flex: 1,
                  height: `${h.pct}%`,
                  borderRadius: 4,
                  background: h.peak ? "var(--acc)" : "var(--nest)",
                  border: "1px solid var(--hair)",
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
            peak 84° at 17:00
          </span>
        </MockTile>
        <MockTile icon="car" tint={T.red} label="Tesla" right={<Pill>Parked</Pill>}>
          <BigValue value="81%" unit="· 240 mi" sub="charging done 06:10" />
        </MockTile>

        <MockTile icon="lamp" tint={T.amber} label="Controls">
          <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
            <TapCell icon="lamp" label="Lamp" initialOn />
            <TapCell icon="bulb" label="Spots" />
            <TapCell icon="sparkles" label="Scene" />
          </div>
        </MockTile>
        <MockTile icon="cam" tint={T.gray} label="Living Room Cam" right={<span className="dot" />}>
          <CamFeed />
        </MockTile>

        <MockTile
          icon="speaker"
          tint={T.purple}
          label="Sound System"
          right={<Pill tone={PillTone.On}>Playing</Pill>}
        >
          <span style={{ fontSize: 14, color: "var(--ink)", marginTop: "auto" }}>
            Khruangbin — So We Won't Forget
          </span>
          <div
            style={{
              marginTop: 8,
              height: 5,
              borderRadius: 999,
              background: "var(--nest)",
              overflow: "hidden",
            }}
          >
            <div style={{ width: "62%", height: "100%", background: "var(--acc)" }} />
          </div>
        </MockTile>
        <MockTile icon="calendar" tint={T.blue} label="Upcoming">
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13.5 }}>
              <span style={{ ...MONO, fontSize: 12.5, color: "var(--ink-2)" }}>17:30</span> · Dinner
              with Sam
            </span>
            <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
              <span style={{ ...MONO, fontSize: 12.5, color: "var(--ink-3)" }}>Sat</span> · Farmers
              market
            </span>
          </div>
        </MockTile>
        <MockTile icon="wifi" tint={T.green} label="Network" right={<span className="dot" />}>
          <BigValue value="884" unit="Mbps" sub="panel online · 12 devices" />
        </MockTile>
      </div>
    </Frame>
  );
}

// ─── Concept B , Hub dock (board + persistent hub launcher bar) ────────────

const DOCK_HUBS: { key: string; label: string; icon: IconName; tint: string }[] = [
  { key: "climate", label: "Climate", icon: "thermo", tint: T.teal },
  { key: "media", label: "Media", icon: "speaker", tint: T.purple },
  { key: "tesla", label: "Tesla", icon: "car", tint: T.red },
  { key: "weather", label: "Weather", icon: "cloud-sun", tint: T.amber },
  { key: "settings", label: "Settings", icon: "settings", tint: T.gray },
];

export function BoardConceptHubDock() {
  const [activeHub, setActiveHub] = useState<string | null>(null);
  return (
    <Frame>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gridTemplateRows: "repeat(3, 1fr)",
          gap: 14,
          padding: "18px 18px 0",
        }}
      >
        <div
          style={{
            gridColumn: "1 / span 2",
            gridRow: "1",
            background: "var(--tile)",
            border: "1px solid var(--hair-2)",
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...MONO, fontSize: 64, lineHeight: 1, letterSpacing: "-0.04em" }}>
              14:32
            </span>
            <span style={{ fontSize: 14, color: "var(--ink-2)" }}>
              Friday · sunny · outside 81°
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <Pill tone={PillTone.On}>House cooling</Pill>
            <Pill>Quiet hours 23:00</Pill>
          </div>
        </div>
        <MockTile icon="cloud-sun" tint={T.amber} label="Weather Now">
          <BigValue value="74°" sub="feels 76° · peak 84°" />
        </MockTile>
        <MockTile
          icon="thermo"
          tint={T.teal}
          label="Climate · A/C"
          right={<Pill tone={PillTone.On}>Cooling</Pill>}
        >
          <BigValue value="72°" unit="set" sub="ambient 74°" />
        </MockTile>
        <MockTile icon="cam" tint={T.gray} label="Living Room Cam" right={<span className="dot" />}>
          <CamFeed />
        </MockTile>
        <MockTile icon="lamp" tint={T.amber} label="Controls">
          <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
            <TapCell icon="lamp" label="Lamp" initialOn />
            <TapCell icon="bulb" label="Spots" />
            <TapCell icon="sparkles" label="Scene" />
          </div>
        </MockTile>
        <MockTile
          icon="speaker"
          tint={T.purple}
          label="Sound System"
          right={<Pill tone={PillTone.On}>Playing</Pill>}
        >
          <span style={{ fontSize: 14, marginTop: "auto" }}>Khruangbin — So We Won't Forget</span>
          <div
            style={{
              marginTop: 8,
              height: 5,
              borderRadius: 999,
              background: "var(--nest)",
              overflow: "hidden",
            }}
          >
            <div style={{ width: "62%", height: "100%", background: "var(--acc)" }} />
          </div>
        </MockTile>
        <MockTile icon="car" tint={T.red} label="Tesla" right={<Pill>Parked</Pill>}>
          <BigValue value="81%" unit="· 240 mi" sub="charging done 06:10" />
        </MockTile>
        <MockTile icon="calendar" tint={T.blue} label="Upcoming">
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13.5 }}>
              <span style={{ ...MONO, fontSize: 12.5, color: "var(--ink-2)" }}>17:30</span> · Dinner
              with Sam
            </span>
            <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
              <span style={{ ...MONO, fontSize: 12.5, color: "var(--ink-3)" }}>Sat</span> · Farmers
              market
            </span>
          </div>
        </MockTile>
        <MockTile icon="wifi" tint={T.green} label="Network" right={<span className="dot" />}>
          <BigValue value="884" unit="Mbps" sub="12 devices" />
        </MockTile>
      </div>
      {/* Dock */}
      <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            background: "var(--tile)",
            border: "1px solid var(--hair-2)",
            borderRadius: 999,
            boxShadow: "0 10px 30px -18px rgba(0,0,0,0.8)",
          }}
        >
          {DOCK_HUBS.map((h) => {
            const on = activeHub === h.key;
            return (
              <button
                key={h.key}
                type="button"
                onClick={() => setActiveHub(on ? null : h.key)}
                aria-pressed={on}
                aria-label={`Open ${h.label} hub`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 16px 7px 8px",
                  background: on ? "var(--nest)" : "transparent",
                  border: on ? "1px solid var(--hair-2)" : "1px solid transparent",
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                <ChipIcon icon={h.icon} tint={h.tint} s={30} />
                <span style={{ fontSize: 14.5, color: on ? "var(--ink)" : "var(--ink-2)" }}>
                  {h.label}
                </span>
              </button>
            );
          })}
          <span
            style={{ width: 1, alignSelf: "stretch", background: "var(--hair)", margin: "4px 6px" }}
          />
          <span style={{ display: "flex", gap: 8, paddingRight: 8 }}>
            <Pill>81° out</Pill>
            <Pill tone={PillTone.On}>All systems ok</Pill>
          </span>
        </div>
      </div>
    </Frame>
  );
}

// ─── Concept C , Domain clusters (SectionCard at board scale) ──────────────

function Cluster({
  title,
  cols,
  children,
  style,
}: {
  title: string;
  cols: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, ...style }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--ink-3)",
          fontWeight: 600,
          margin: "0 4px",
        }}
      >
        {title}
      </span>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--hair)",
          borderRadius: 20,
          padding: 12,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 12,
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function BoardConceptDomainClusters() {
  return (
    <Frame>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1.15fr 1fr",
          gridTemplateRows: "auto 1fr 1fr",
          gap: 16,
          padding: 18,
        }}
      >
        {/* Header strip spans both columns */}
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 18,
            background: "var(--tile)",
            border: "1px solid var(--hair-2)",
            borderRadius: 20,
            padding: "14px 24px",
          }}
        >
          <span style={{ ...MONO, fontSize: 44, lineHeight: 1, letterSpacing: "-0.04em" }}>
            14:32
          </span>
          <span style={{ fontSize: 14, color: "var(--ink-2)" }}>Friday afternoon</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Pill>Outside 81° · sunny</Pill>
            <Pill tone={PillTone.On}>House cooling</Pill>
            <Pill>Wi-Fi 884 Mbps</Pill>
          </span>
        </div>

        <Cluster title="Media" cols={2}>
          <MockTile
            icon="speaker"
            tint={T.purple}
            label="Sound"
            right={<Pill tone={PillTone.On}>Playing</Pill>}
          >
            <span style={{ fontSize: 13.5, marginTop: "auto" }}>
              Khruangbin — So We Won't Forget
            </span>
            <div
              style={{
                marginTop: 8,
                height: 5,
                borderRadius: 999,
                background: "var(--nest)",
                overflow: "hidden",
              }}
            >
              <div style={{ width: "62%", height: "100%", background: "var(--acc)" }} />
            </div>
          </MockTile>
          <MockTile icon="apps" tint={T.blue} label="TV" right={<Pill>Idle</Pill>}>
            <span style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: "auto" }}>
              Apple TV · last: Severance
            </span>
          </MockTile>
        </Cluster>

        <Cluster title="Climate" cols={2}>
          <MockTile
            icon="thermo"
            tint={T.teal}
            label="A/C"
            right={<Pill tone={PillTone.On}>Cooling</Pill>}
          >
            <BigValue value="72°" unit="set" sub="ambient 74° · 46% rh" />
          </MockTile>
          <MockTile icon="cloud-sun" tint={T.amber} label="Weather">
            <BigValue value="74°" sub="peak 84° at 17:00" />
          </MockTile>
        </Cluster>

        <Cluster title="House" cols={3}>
          <MockTile icon="lamp" tint={T.amber} label="Lights">
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
              <TapCell icon="lamp" label="Lamp" initialOn />
              <TapCell icon="bulb" label="Spots" />
            </div>
          </MockTile>
          <MockTile icon="cam" tint={T.gray} label="Cam" right={<span className="dot" />}>
            <CamFeed />
          </MockTile>
          <MockTile icon="calendar" tint={T.blue} label="Upcoming">
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13 }}>
                <span style={{ ...MONO, fontSize: 12, color: "var(--ink-2)" }}>17:30</span> · Dinner
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                <span style={{ ...MONO, fontSize: 12, color: "var(--ink-3)" }}>Sat</span> · Market
              </span>
            </div>
          </MockTile>
        </Cluster>

        <Cluster title="System" cols={3}>
          <MockTile icon="car" tint={T.red} label="Tesla" right={<Pill>Parked</Pill>}>
            <BigValue value="81%" sub="240 mi" />
          </MockTile>
          <MockTile icon="wifi" tint={T.green} label="Network" right={<span className="dot" />}>
            <BigValue value="884" unit="Mbps" sub="12 devices" />
          </MockTile>
          <MockTile
            icon="bolt"
            tint={T.purple}
            label="Deploys"
            right={<Pill tone={PillTone.On}>Green</Pill>}
          >
            <span style={{ fontSize: 13, color: "var(--ink-2)", marginTop: "auto" }}>
              main · cb4f3a8 · 11:18
            </span>
          </MockTile>
        </Cluster>
      </div>
    </Frame>
  );
}
