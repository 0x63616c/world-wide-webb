/**
 * ClimateHubConcepts , three full-page (1366x1024) Climate hub layout concepts
 * applying the approved settings-page design language to a data-rich hub.
 * PROTOTYPE: real ui primitives wired to local placeholder state only , no
 * trpc, no persistence. One concept wins; the losers get deleted.
 *
 *  A , Zones sidebar: the SettingsPage twin. 340px tinted-chip zone sidebar +
 *      maxWidth-720 column of SectionCards for the selected zone.
 *  B , Canvas split: viz-first. A big interactive zone canvas on the left,
 *      380px inspector column of SectionCards on the right.
 *  C , Focus deck: touch-first. Horizontal zone rail, giant setpoint hero with
 *      stepper buttons, schedule strip along the bottom.
 */

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Icon, type IconName } from "../Icon";
import {
  ActionButton,
  BackButton,
  ChevronValue,
  PageHeader,
  RowShell,
  SectionCard,
  SliderRow,
} from "../settings-page/blocks";
import { Pill, PillTone, Segmented, Slider, Switch } from "../ui";

// ─── placeholder domain state (local only) ──────────────────────────────────

const MIN = 67;
const MAX = 77;

type HubHvacMode = "off" | "cool" | "heat" | "heat_cool";

const MODE_OPTIONS = [
  { value: "cool", label: "Cool" },
  { value: "heat", label: "Heat" },
  { value: "heat_cool", label: "Heat·Cool" },
  { value: "off", label: "Off" },
] as const;

type ZoneState = {
  key: string;
  label: string;
  icon: IconName;
  tint: string;
  ambient: number;
  humidity: number;
  mode: HubHvacMode;
  target: number;
  action: string;
};

const INITIAL_ZONES: ZoneState[] = [
  {
    key: "living",
    label: "Living Room",
    icon: "lamp",
    tint: "#e0a83c",
    ambient: 74,
    humidity: 46,
    mode: "cool",
    target: 72,
    action: "Cooling",
  },
  {
    key: "bedroom",
    label: "Bedroom",
    icon: "moon",
    tint: "#9a6ad4",
    ambient: 71,
    humidity: 51,
    mode: "cool",
    target: 70,
    action: "Idle",
  },
  {
    key: "office",
    label: "Office",
    icon: "bolt",
    tint: "#4a90d9",
    ambient: 73,
    humidity: 44,
    mode: "off",
    target: 72,
    action: "Off",
  },
  {
    key: "bathroom",
    label: "Bathroom",
    icon: "sparkles",
    tint: "#43a56c",
    ambient: 72,
    humidity: 58,
    mode: "heat",
    target: 73,
    action: "Idle",
  },
];

const SCHEDULE_ROWS: { key: string; label: string; sub: string; value: string }[] = [
  { key: "wake", label: "Morning", sub: "Weekdays · 6:30", value: "72°" },
  { key: "away", label: "Away", sub: "Weekdays · 9:00", value: "76°" },
  { key: "evening", label: "Evening", sub: "Every day · 17:30", value: "71°" },
  { key: "night", label: "Night", sub: "Every day · 23:00", value: "69°" },
];

function useZones() {
  const [zones, setZones] = useState(INITIAL_ZONES);
  const [selectedKey, setSelectedKey] = useState(INITIAL_ZONES[0].key);
  const selected = zones.find((z) => z.key === selectedKey) ?? zones[0];
  const patch = (key: string, p: Partial<ZoneState>) =>
    setZones((zs) => zs.map((z) => (z.key === key ? { ...z, ...p } : z)));
  return { zones, selected, setSelectedKey, patch };
}

function modeLabel(mode: HubHvacMode): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode;
}

function zoneBlurb(z: ZoneState): string {
  if (z.mode === "off") return `${z.ambient}° now · HVAC off`;
  return `${z.ambient}° now · ${z.action} to ${z.target}°`;
}

// ─── shared frame ───────────────────────────────────────────────────────────

/** Fixed 1366x1024 wall-panel frame, same as the settings concepts. */
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
        display: "flex",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const MONO_TEMP: CSSProperties = { fontFamily: "var(--mono)", color: "var(--ink)" };

/** The 34px tinted icon chip from the settings sidebar. */
function TintChip({ icon, tint, s = 34 }: { icon: IconName; tint: string; s?: number }) {
  return (
    <span
      style={{
        width: s,
        height: s,
        borderRadius: Math.round(s * 0.26),
        background: tint,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={icon} s={Math.round(s * 0.56)} sw={2} />
    </span>
  );
}

/** SectionCards shared by every concept's zone detail (Now / Mode / Setpoint / Extras). */
function ZoneDetailCards({
  zone,
  onPatch,
  schedule = true,
}: {
  zone: ZoneState;
  onPatch: (p: Partial<ZoneState>) => void;
  schedule?: boolean;
}) {
  const [fanAlways, setFanAlways] = useState(false);
  const [eco, setEco] = useState(true);
  return (
    <>
      <SectionCard title="Now">
        {[
          <RowShell
            key="ambient"
            label="Ambient"
            control={<span style={{ ...MONO_TEMP, fontSize: 15 }}>{zone.ambient}°</span>}
          />,
          <RowShell
            key="humidity"
            label="Humidity"
            control={<span style={{ ...MONO_TEMP, fontSize: 15 }}>{zone.humidity}%</span>}
          />,
          <RowShell
            key="activity"
            label="Activity"
            control={
              <Pill
                tone={
                  zone.action === "Cooling" || zone.action === "Heating"
                    ? PillTone.On
                    : PillTone.Default
                }
              >
                {zone.action}
              </Pill>
            }
          />,
        ]}
      </SectionCard>
      <SectionCard title="Mode">
        {[
          <div key="mode">
            <Segmented
              options={MODE_OPTIONS}
              value={zone.mode}
              onChange={(mode) =>
                onPatch({
                  mode,
                  action: mode === "off" ? "Off" : zone.action === "Off" ? "Idle" : zone.action,
                })
              }
              label={`${zone.label} mode`}
            />
          </div>,
        ]}
      </SectionCard>
      {zone.mode !== "off" ? (
        <SectionCard title="Setpoint">
          {[
            <SliderRow key="target">
              <Slider
                label={`${zone.label} setpoint`}
                value={zone.target}
                min={MIN}
                max={MAX}
                step={1}
                format={(n) => `${n}°`}
                onChange={(target) => onPatch({ target })}
              />
            </SliderRow>,
          ]}
        </SectionCard>
      ) : null}
      {schedule ? (
        <SectionCard title="Schedule">
          {SCHEDULE_ROWS.map((r) => (
            <RowShell
              key={r.key}
              label={r.label}
              sub={r.sub}
              control={<ChevronValue value={r.value} />}
            />
          ))}
        </SectionCard>
      ) : null}
      <SectionCard title="Extras">
        {[
          <RowShell
            key="fan"
            label="Fan always on"
            sub="Circulate air even while idle"
            control={<Switch checked={fanAlways} onChange={setFanAlways} label="Fan always on" />}
          />,
          <RowShell
            key="eco"
            label="Eco when away"
            sub="Relax setpoints when nobody is home"
            control={<Switch checked={eco} onChange={setEco} label="Eco when away" />}
          />,
        ]}
      </SectionCard>
    </>
  );
}

// ─── Concept A , Zones sidebar (SettingsPage twin) ─────────────────────────

export function ClimateHubConceptZonesSidebar() {
  const { zones, selected, setSelectedKey, patch } = useZones();
  const avg = Math.round(zones.reduce((a, z) => a + z.ambient, 0) / zones.length);
  const running = zones.filter((z) => z.action === "Cooling" || z.action === "Heating").length;
  return (
    <Frame>
      <div
        style={{
          width: 340,
          flexShrink: 0,
          borderRight: "1px solid var(--hair)",
          background: "var(--tile)",
          display: "flex",
          flexDirection: "column",
          padding: 24,
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BackButton onClick={() => {}} />
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Climate</h1>
        </div>
        <div
          style={{
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 14,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--ink-3)",
              }}
            >
              Whole house
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
              {running === 0 ? "All idle" : `${running} zone${running === 1 ? "" : "s"} running`}
            </span>
          </div>
          <span style={{ ...MONO_TEMP, fontSize: 26 }}>{avg}°</span>
        </div>
        <nav
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
          aria-label="Climate zones"
        >
          {zones.map((z) => {
            const on = z.key === selected.key;
            return (
              <button
                key={z.key}
                type="button"
                onClick={() => setSelectedKey(z.key)}
                aria-current={on ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "10px 12px",
                  background: on ? "var(--nest)" : "transparent",
                  border: on ? "1px solid var(--hair-2)" : "1px solid transparent",
                  borderRadius: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <TintChip icon={z.icon} tint={z.tint} />
                <span
                  style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}
                >
                  <span style={{ fontSize: 16, color: "var(--ink)" }}>{z.label}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {z.mode === "off" ? "Off" : `${modeLabel(z.mode)} · ${z.target}°`}
                  </span>
                </span>
                <span style={{ ...MONO_TEMP, fontSize: 15, color: "var(--ink-2)" }}>
                  {z.ambient}°
                </span>
              </button>
            );
          })}
        </nav>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "40px 64px" }}>
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <PageHeader title={selected.label} blurb={zoneBlurb(selected)} />
          <ZoneDetailCards zone={selected} onPatch={(p) => patch(selected.key, p)} />
        </div>
      </div>
    </Frame>
  );
}

// ─── Concept B , Canvas split (viz-first) ──────────────────────────────────

export function ClimateHubConceptCanvasSplit() {
  const { zones, selected, setSelectedKey, patch } = useZones();
  return (
    <Frame>
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 32px", gap: 24 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BackButton onClick={() => {}} />
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Climate</h1>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Pill>Outside 81°</Pill>
            <Pill tone={PillTone.On}>1 zone cooling</Pill>
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 16,
          }}
        >
          {zones.map((z) => {
            const on = z.key === selected.key;
            const active = z.action === "Cooling" || z.action === "Heating";
            return (
              <button
                key={z.key}
                type="button"
                onClick={() => setSelectedKey(z.key)}
                aria-label={`Select ${z.label}`}
                aria-pressed={on}
                style={{
                  background: "var(--tile)",
                  border: on ? "1px solid var(--acc-line)" : "1px solid var(--hair)",
                  boxShadow: on ? "var(--acc-glow)" : "none",
                  borderRadius: 20,
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <TintChip icon={z.icon} tint={z.tint} s={30} />
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      color: "var(--ink-3)",
                      fontWeight: 600,
                    }}
                  >
                    {z.label}
                  </span>
                  <span style={{ marginLeft: "auto" }}>
                    <Pill tone={active ? PillTone.On : PillTone.Default}>{z.action}</Pill>
                  </span>
                </div>
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: "auto" }}
                >
                  <span style={{ ...MONO_TEMP, fontSize: 54, lineHeight: 1 }}>{z.ambient}°</span>
                  <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                    {z.mode === "off" ? "off" : `→ ${z.target}°`}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--ink-3)" }}>
                    {z.humidity}% rh
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div
        style={{
          width: 380,
          flexShrink: 0,
          borderLeft: "1px solid var(--hair)",
          background: "var(--tile)",
          overflowY: "auto",
          padding: "28px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <PageHeader title={selected.label} blurb={zoneBlurb(selected)} />
        <ZoneDetailCards zone={selected} onPatch={(p) => patch(selected.key, p)} />
      </div>
    </Frame>
  );
}

// ─── Concept C , Focus deck (touch-first hero) ─────────────────────────────

export function ClimateHubConceptFocusDeck() {
  const { zones, selected, setSelectedKey, patch } = useZones();
  const step = (d: number) =>
    patch(selected.key, { target: Math.min(MAX, Math.max(MIN, selected.target + d)) });
  const stepButton: CSSProperties = {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "var(--nest)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink)",
    fontSize: 30,
    fontFamily: "var(--mono)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  return (
    <Frame>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "28px 40px 32px",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BackButton onClick={() => {}} />
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Climate</h1>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {zones.map((z) => {
              const on = z.key === selected.key;
              return (
                <button
                  key={z.key}
                  type="button"
                  onClick={() => setSelectedKey(z.key)}
                  aria-pressed={on}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 14px 8px 8px",
                    background: on ? "var(--nest)" : "transparent",
                    border: on ? "1px solid var(--hair-2)" : "1px solid var(--hair)",
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                >
                  <TintChip icon={z.icon} tint={z.tint} s={26} />
                  <span style={{ fontSize: 14, color: on ? "var(--ink)" : "var(--ink-2)" }}>
                    {z.label}
                  </span>
                  <span style={{ ...MONO_TEMP, fontSize: 13, color: "var(--ink-3)" }}>
                    {z.ambient}°
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: "var(--tile)",
            border: "1px solid var(--hair)",
            borderRadius: 24,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <TintChip icon={selected.icon} tint={selected.tint} s={30} />
            <span style={{ fontSize: 17, color: "var(--ink-2)" }}>{selected.label}</span>
            <Pill
              tone={
                selected.action === "Cooling" || selected.action === "Heating"
                  ? PillTone.On
                  : PillTone.Default
              }
            >
              {selected.action}
            </Pill>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
            <button type="button" aria-label="Cooler" style={stepButton} onClick={() => step(-1)}>
              −
            </button>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span
                style={{ ...MONO_TEMP, fontSize: 148, lineHeight: 1, letterSpacing: "-0.04em" }}
              >
                {selected.mode === "off" ? "—" : `${selected.target}°`}
              </span>
              <span style={{ fontSize: 14, color: "var(--ink-3)" }}>
                ambient {selected.ambient}° · {selected.humidity}% rh
              </span>
            </div>
            <button type="button" aria-label="Warmer" style={stepButton} onClick={() => step(1)}>
              +
            </button>
          </div>
          <div style={{ width: 420 }}>
            <Segmented
              options={MODE_OPTIONS}
              value={selected.mode}
              onChange={(mode) =>
                patch(selected.key, { mode, action: mode === "off" ? "Off" : "Idle" })
              }
              label={`${selected.label} mode`}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <div
            style={{
              flex: 1,
              background: "var(--tile)",
              border: "1px solid var(--hair)",
              borderRadius: 18,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: 0,
            }}
          >
            {SCHEDULE_ROWS.map((r, i) => (
              <div
                key={r.key}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  paddingLeft: i === 0 ? 0 : 20,
                  borderLeft: i === 0 ? "none" : "1px solid var(--hair)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.14em",
                    color: "var(--ink-3)",
                  }}
                >
                  {r.label}
                </span>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{r.sub}</span>
                <span style={{ ...MONO_TEMP, fontSize: 16 }}>{r.value}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              width: 220,
              background: "var(--tile)",
              border: "1px solid var(--hair)",
              borderRadius: 18,
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--ink-3)",
              }}
            >
              Quick actions
            </span>
            <ActionButton>Everything off</ActionButton>
            <ActionButton>Edit schedule</ActionButton>
          </div>
        </div>
      </div>
    </Frame>
  );
}
