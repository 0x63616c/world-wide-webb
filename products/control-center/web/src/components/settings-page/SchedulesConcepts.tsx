/**
 * SchedulesConcepts , throwaway Storybook-only concepts exploring a re-styled
 * Schedules tile + modal in the approved Settings visual language (Concept A,
 * "Grouped cards": mono uppercase section labels, hairline-separated rows inside
 * inset cards, tinted icon chips). Sits beside SettingsPageConcepts so the two
 * can be judged as one system.
 *
 * Everything here is placeholder: every control is a REAL shared primitive
 * (Tile / TileHeader / Switch) wired to local state, but the schedule data is
 * hard-coded sample state modelled on the real schedules tRPC shape (see
 * tiles/modals/ExpandedSchedulesModalView). Nothing reads or writes the API.
 * Once a direction is picked this file dies and the real tile/modal get built.
 *
 *   SchedulesTileConcept  , a smaller, denser schedules tile (compact header +
 *     count pill, two tight schedule rows, a next-run footer).
 *   SchedulesModalConcept , the full schedules manager re-imagined as a
 *     full-page settings surface: dimmed 1366x1024 backdrop, centered card of
 *     grouped inset sections (Up next / Active schedules / add-row).
 */

import { type CSSProperties, type ReactNode, useState } from "react";
import { Icon, type IconName } from "../Icon";
import { Pill, PillTone } from "../ui/Pill";
import { StatusDot } from "../ui/StatusDot";
import { Switch } from "../ui/Switch";
import { Tile } from "../ui/Tile";
import { TileHeader } from "../ui/TileHeader";

// ---------------------------------------------------------------------------
// Placeholder schedule model , mirrors the ScheduleItem shape from
// tiles/modals/ExpandedSchedulesModalView (name, enabled, days, trigger,
// action) trimmed to what these concepts render.
// ---------------------------------------------------------------------------

type SceneName = "white" | "mood" | "red" | "blue" | "off";

interface SampleSchedule {
  id: string;
  name: string;
  /** Resolved fire time / label, e.g. "21:30" or "sunset +15m". */
  time: string;
  /** Human day summary, e.g. "Every day" or "Mon–Fri". */
  days: string;
  scene: SceneName;
  enabled: boolean;
}

interface SceneStyle {
  icon: IconName;
  tint: string;
}

const SCENE_STYLE: Record<SceneName, SceneStyle> = {
  white: { icon: "sun", tint: "#e0a83c" },
  mood: { icon: "sparkles", tint: "#9a6ad4" },
  red: { icon: "lamp", tint: "#c95c5c" },
  blue: { icon: "moon", tint: "#4a90d9" },
  off: { icon: "bulb-off", tint: "#6e6e6e" },
};

const SAMPLE_SCHEDULES: SampleSchedule[] = [
  {
    id: "sched_wake",
    name: "Wake white",
    time: "06:45",
    days: "Mon–Fri",
    scene: "white",
    enabled: true,
  },
  {
    id: "sched_red",
    name: "Red night",
    time: "21:30",
    days: "Every day",
    scene: "red",
    enabled: true,
  },
  {
    id: "sched_movie",
    name: "Movie mood",
    time: "sunset +15m",
    days: "Fri, Sat",
    scene: "mood",
    enabled: true,
  },
  {
    id: "sched_away",
    name: "Away off",
    time: "09:00",
    days: "Mon–Fri",
    scene: "off",
    enabled: false,
  },
];

/** The single next upcoming fire, as the tile + modal footer show it. */
const SAMPLE_NEXT = { name: "Wake white", time: "06:45", scene: "white" as SceneName };

function useSampleSchedules() {
  const [schedules, setSchedules] = useState(SAMPLE_SCHEDULES);
  const toggle = (id: string, enabled: boolean) =>
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  return { schedules, toggle };
}

// ---------------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------------

/** Tinted rounded icon chip , the settings-page sidebar vocabulary. */
function SceneChip({ scene, size = 34 }: { scene: SceneName; size?: number }) {
  const { icon, tint } = SCENE_STYLE[scene];
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        background: tint,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={icon} s={Math.round(size * 0.56)} sw={2} />
    </span>
  );
}

const SECTION_LABEL: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--ink-3)",
  margin: "0 4px 8px",
};

// ---------------------------------------------------------------------------
// Concept , the compact tile.
// ---------------------------------------------------------------------------

/**
 * A tighter Schedules tile. Where today's tile is one big count + a next line,
 * this fits a compact header (count pill on the right), the two soonest active
 * schedules as dense rows, and a next-run footer , all inside a small tile.
 */
export function SchedulesTileConcept() {
  const { schedules } = useSampleSchedules();
  const active = schedules.filter((s) => s.enabled);
  const visible = active.slice(0, 2);

  return (
    <div style={{ width: 340, height: 236 }}>
      <Tile padding={16} style={{ cursor: "pointer" }}>
        <TileHeader
          icon="calendar"
          title="Schedules"
          titleSize={15}
          iconSize={17}
          right={
            <Pill tone={PillTone.On}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{active.length} on</span>
            </Pill>
          }
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {visible.map((s) => (
            <div
              key={s.id}
              style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 34 }}
            >
              <SceneChip scene={s.scene} size={28} />
              <div
                style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}
              >
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--ink-1)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.name}
                </span>
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{s.days}</span>
              </div>
              <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-2)" }}>
                {s.time}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: 12,
            borderTop: "1px solid var(--hair)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <StatusDot online />
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Next · {SAMPLE_NEXT.name}</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            {SAMPLE_NEXT.time}
          </span>
        </div>
      </Tile>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Concept , the full-page modal.
// ---------------------------------------------------------------------------

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div style={SECTION_LABEL}>{title}</div>
      <div
        style={{
          background: "var(--tile)",
          border: "1px solid var(--hair)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function RowWrap({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <div style={{ padding: "12px 18px", borderTop: first ? "none" : "1px solid var(--hair)" }}>
      {children}
    </div>
  );
}

/**
 * The schedules manager re-drawn as a settings-style full-page surface: a
 * dimmed board backdrop with a centered card. "Up next" spotlights the next
 * fire, "Active schedules" lists every schedule as a selectable hairline row
 * with an enable Switch, and a final add-row seeds a new one. Selecting a row
 * (its name button) highlights it , stands in for opening the editor.
 */
export function SchedulesModalConcept() {
  const { schedules, toggle } = useSampleSchedules();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const enabledCount = schedules.filter((s) => s.enabled).length;

  return (
    <div
      style={{
        width: 1366,
        height: 1024,
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--ui)",
      }}
    >
      {/* Dimmed backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)" }} />

      {/* Centered card */}
      <div
        style={{
          position: "relative",
          width: 720,
          maxHeight: 880,
          background: "var(--bg)",
          border: "1px solid var(--hair)",
          borderRadius: 24,
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "24px 28px 20px",
            borderBottom: "1px solid var(--hair)",
          }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: "#4a90d9",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="calendar" s={22} sw={2} />
          </span>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 650, color: "var(--ink)" }}>
              Schedules
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
              {enabledCount} of {schedules.length} running
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 12,
              color: "var(--ink-2)",
              cursor: "pointer",
              transform: "rotate(180deg)",
            }}
          >
            <Icon name="chevron" s={20} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            overflowY: "auto",
            padding: "24px 28px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 26,
          }}
        >
          <SectionCard title="Up next">
            <RowWrap first>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <SceneChip scene={SAMPLE_NEXT.scene} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 500 }}>
                    {SAMPLE_NEXT.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Fires next this morning</div>
                </div>
                <span style={{ fontFamily: "var(--mono)", fontSize: 20, color: "var(--ink)" }}>
                  {SAMPLE_NEXT.time}
                </span>
              </div>
            </RowWrap>
          </SectionCard>

          <SectionCard title="Active schedules">
            {schedules.map((s, i) => {
              const selected = s.id === selectedId;
              return (
                <RowWrap key={s.id} first={i === 0}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      borderRadius: 12,
                      background: selected ? "var(--nest)" : "transparent",
                      margin: selected ? "-6px -8px" : 0,
                      padding: selected ? "6px 8px" : 0,
                    }}
                  >
                    <SceneChip scene={s.scene} />
                    <button
                      type="button"
                      onClick={() => setSelectedId(selected ? null : s.id)}
                      aria-pressed={selected}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        font: "inherit",
                        padding: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 15,
                          color: s.enabled ? "var(--ink)" : "var(--ink-3)",
                          fontWeight: 500,
                        }}
                      >
                        {s.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                        <span style={{ fontFamily: "var(--mono)" }}>{s.time}</span> · {s.days}
                      </div>
                    </button>
                    <Switch
                      checked={s.enabled}
                      onChange={(enabled) => toggle(s.id, enabled)}
                      label={`Enable ${s.name}`}
                    />
                  </div>
                </RowWrap>
              );
            })}
          </SectionCard>

          <SectionCard title="Add">
            <RowWrap first>
              <button
                type="button"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  width: "100%",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  font: "inherit",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    border: "1px dashed var(--hair-2)",
                    color: "var(--ink-3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="plus" s={18} sw={2} />
                </span>
                <span style={{ fontSize: 15, color: "var(--ink-2)" }}>New schedule</span>
              </button>
            </RowWrap>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
