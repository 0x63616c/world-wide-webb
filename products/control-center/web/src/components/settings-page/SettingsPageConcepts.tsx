/**
 * SettingsPageConcepts , three throwaway full-page layouts exploring what a
 * full-screen Settings (replacing the current modal) could look like on the
 * fixed 1366x1024 wall panel. Storybook-only: every control is a REAL shared
 * primitive (Switch / Slider / Segmented / TextInput) wired to local state, but
 * the values are placeholder , nothing reads or writes lib/settings.
 *
 * Concept A , "Grouped cards": iOS-Settings-style sidebar with tinted icon
 *   chips + inset grouped cards on the right.
 * Concept B , "Icon rail": narrow icon-only rail + one centered flat column,
 *   Linear/Vercel feel.
 * Concept C , "Split detail": descriptive sidebar rows + a two-column card
 *   grid per page.
 *
 * Once a direction is picked this file dies and the real SettingsPage gets
 * built properly against lib/settings.
 */

import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
import { Icon, type IconName } from "../Icon";
import { Segmented } from "../ui/Segmented";
import { Slider } from "../ui/Slider";
import { Switch } from "../ui/Switch";
import { TextInput } from "../ui/TextInput";

// ---------------------------------------------------------------------------
// Placeholder settings model , local state standing in for lib/settings.
// ---------------------------------------------------------------------------

type SnapMode = "free" | "gentle" | "grid";

interface DemoSettings {
  deviceName: string;
  brightness: number;
  idleDim: boolean;
  dimAfterMin: number;
  dimLevel: number;
  recenter: boolean;
  recenterAfterMin: number;
  snapMode: SnapMode;
  showFps: boolean;
  showBuildBadge: boolean;
  notifications: boolean;
  quietHours: boolean;
}

const DEFAULTS: DemoSettings = {
  deviceName: "Hallway Panel",
  brightness: 82,
  idleDim: true,
  dimAfterMin: 5,
  dimLevel: 30,
  recenter: true,
  recenterAfterMin: 3,
  snapMode: "gentle",
  showFps: false,
  showBuildBadge: true,
  notifications: true,
  quietHours: false,
};

const SNAP_OPTIONS: { value: SnapMode; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "gentle", label: "Gentle" },
  { value: "grid", label: "Grid" },
];

function useDemoSettings() {
  const [s, setS] = useState(DEFAULTS);
  const patch = (p: Partial<DemoSettings>) => setS((prev) => ({ ...prev, ...p }));
  return { s, patch };
}

// ---------------------------------------------------------------------------
// Page registry , shared across all three concepts.
// ---------------------------------------------------------------------------

type PageKey = "device" | "display" | "board" | "network" | "notifications" | "debug" | "about";

interface PageDef {
  key: PageKey;
  label: string;
  icon: IconName;
  /** Tinted chip color for Concept A's iOS-style sidebar. */
  tint: string;
  blurb: string;
}

const PAGES: PageDef[] = [
  {
    key: "device",
    label: "Device",
    icon: "settings",
    tint: "#8e8e93",
    blurb: "Name, battery, mount level",
  },
  {
    key: "display",
    label: "Display",
    icon: "sun",
    tint: "#e0a83c",
    blurb: "Brightness and idle dimming",
  },
  { key: "board", label: "Board", icon: "apps", tint: "#4a90d9", blurb: "Snap, recenter, layout" },
  {
    key: "network",
    label: "Network",
    icon: "wifi",
    tint: "#43a56c",
    blurb: "Wi-Fi and connectivity",
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: "bell",
    tint: "#c95c5c",
    blurb: "Alerts and quiet hours",
  },
  { key: "debug", label: "Debug", icon: "bolt", tint: "#9a6ad4", blurb: "FPS, build badge, logs" },
  {
    key: "about",
    label: "About",
    icon: "globe",
    tint: "#6e6e6e",
    blurb: "Build, version, licenses",
  },
];

const PAGE_BY_KEY = Object.fromEntries(PAGES.map((p) => [p.key, p])) as Record<PageKey, PageDef>;

// ---------------------------------------------------------------------------
// Shared row/section building blocks.
// ---------------------------------------------------------------------------

function RowShell({ label, sub, control }: { label: string; sub?: string; control: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        minHeight: 40,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--ui)", fontSize: 15, color: "var(--ink)" }}>{label}</span>
        {sub ? (
          <span style={{ fontFamily: "var(--ui)", fontSize: 12, color: "var(--ink-3)" }}>
            {sub}
          </span>
        ) : null}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

const VALUE_TEXT: CSSProperties = { fontFamily: "var(--mono)", fontSize: 14, color: "var(--ink)" };

const ACTION_BUTTON: CSSProperties = {
  padding: "8px 14px",
  background: "var(--nest)",
  border: "1px solid var(--hair)",
  borderRadius: 10,
  fontFamily: "var(--ui)",
  fontSize: 13,
  color: "var(--ink-2)",
  cursor: "pointer",
};

function ChevronValue({ value }: { value: string }) {
  return (
    <span style={{ ...VALUE_TEXT, display: "inline-flex", alignItems: "center", gap: 8 }}>
      {value}
      <span style={{ color: "var(--ink-3)" }}>
        <Icon name="chevron" s={16} />
      </span>
    </span>
  );
}

/**
 * One page's rows, as a list of "blocks" so each concept can frame them its own
 * way (grouped inset cards vs flat hairline sections vs card grid). Every block
 * is a titled cluster of related rows.
 */
interface Block {
  title: string;
  // Elements, not nodes: every row carries its own stable `key`, which the
  // concepts reuse when they wrap rows in their own framing divs.
  rows: ReactElement[];
}

function pageBlocks(
  page: PageKey,
  s: DemoSettings,
  patch: (p: Partial<DemoSettings>) => void,
): Block[] {
  switch (page) {
    case "device":
      return [
        {
          title: "Identity",
          rows: [
            <TextInput
              key="name"
              label="Device name"
              value={s.deviceName}
              placeholder="Hallway Panel"
              onChange={(deviceName) => patch({ deviceName })}
            />,
          ],
        },
        {
          title: "Status",
          rows: [
            <RowShell
              key="battery"
              label="Battery"
              sub="Charge state of this panel."
              control={<span style={VALUE_TEXT}>94% charging</span>}
            />,
            <RowShell
              key="level"
              label="Level"
              sub="Open the full screen level to adjust the mount."
              control={<ChevronValue value="0.4°" />}
            />,
            <RowShell
              key="uptime"
              label="Uptime"
              sub="Since the last app launch."
              control={<span style={VALUE_TEXT}>6d 4h</span>}
            />,
          ],
        },
      ];
    case "display":
      return [
        {
          title: "Brightness",
          rows: [
            <Slider
              key="brightness"
              label="Brightness"
              value={s.brightness}
              min={10}
              max={100}
              step={1}
              format={(n) => `${n}%`}
              onChange={(brightness) => patch({ brightness })}
            />,
          ],
        },
        {
          title: "Idle dimming",
          rows: [
            <RowShell
              key="dim"
              label="Dim when idle"
              sub="Lower the panel brightness after a period of no interaction."
              control={
                <Switch
                  label="Dim when idle"
                  checked={s.idleDim}
                  onChange={(idleDim) => patch({ idleDim })}
                />
              }
            />,
            ...(s.idleDim
              ? [
                  <Slider
                    key="dim-after"
                    label="Dim after"
                    value={s.dimAfterMin}
                    min={1}
                    max={30}
                    step={1}
                    format={(n) => `${n} min`}
                    onChange={(dimAfterMin) => patch({ dimAfterMin })}
                  />,
                  <Slider
                    key="dim-level"
                    label="Dim level"
                    value={s.dimLevel}
                    min={5}
                    max={80}
                    step={1}
                    format={(n) => `${n}%`}
                    onChange={(dimLevel) => patch({ dimLevel })}
                  />,
                ]
              : []),
          ],
        },
        {
          title: "Maintenance",
          rows: [
            <RowShell
              key="clean"
              label="Clean screen"
              sub="Locks touches while you wipe the screen."
              control={
                <button type="button" style={ACTION_BUTTON}>
                  Start
                </button>
              }
            />,
          ],
        },
      ];
    case "board":
      return [
        {
          title: "Idle behavior",
          rows: [
            <RowShell
              key="recenter"
              label="Recenter when idle"
              sub="Glide back to the Clock after a period of no interaction."
              control={
                <Switch
                  label="Recenter when idle"
                  checked={s.recenter}
                  onChange={(recenter) => patch({ recenter })}
                />
              }
            />,
            ...(s.recenter
              ? [
                  <Slider
                    key="recenter-after"
                    label="Recenter after"
                    value={s.recenterAfterMin}
                    min={1}
                    max={30}
                    step={1}
                    format={(n) => `${n} min`}
                    onChange={(recenterAfterMin) => patch({ recenterAfterMin })}
                  />,
                ]
              : []),
          ],
        },
        {
          title: "Feel",
          rows: [
            <div key="snap" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontFamily: "var(--ui)", fontSize: 15, color: "var(--ink)" }}>
                Board snap
              </span>
              <span style={{ fontFamily: "var(--ui)", fontSize: 12, color: "var(--ink-3)" }}>
                How the board settles when you let go of a pan.
              </span>
              <Segmented
                label="Board snap"
                options={SNAP_OPTIONS}
                value={s.snapMode}
                onChange={(snapMode) => patch({ snapMode })}
              />
            </div>,
          ],
        },
        {
          title: "Layout",
          rows: [
            <RowShell
              key="edit"
              label="Edit layout"
              sub="Rearrange tiles on the board."
              control={
                <button type="button" style={ACTION_BUTTON}>
                  Edit layout
                </button>
              }
            />,
          ],
        },
      ];
    case "network":
      return [
        {
          title: "Wi-Fi",
          rows: [
            <RowShell
              key="ssid"
              label="Network"
              sub="Currently joined."
              control={<ChevronValue value="webb-iot" />}
            />,
            <RowShell
              key="signal"
              label="Signal"
              control={<span style={VALUE_TEXT}>-52 dBm</span>}
            />,
            <RowShell
              key="ip"
              label="IP address"
              control={<span style={VALUE_TEXT}>10.0.30.42</span>}
            />,
          ],
        },
        {
          title: "Backend",
          rows: [
            <RowShell
              key="api"
              label="API"
              sub="Control-center tRPC endpoint."
              control={<span style={VALUE_TEXT}>connected</span>}
            />,
            <RowShell
              key="latency"
              label="Latency"
              control={<span style={VALUE_TEXT}>18 ms</span>}
            />,
          ],
        },
      ];
    case "notifications":
      return [
        {
          title: "Alerts",
          rows: [
            <RowShell
              key="notif"
              label="Show notifications"
              sub="Doorbell, laundry, and other board alerts."
              control={
                <Switch
                  label="Show notifications"
                  checked={s.notifications}
                  onChange={(notifications) => patch({ notifications })}
                />
              }
            />,
            <RowShell
              key="quiet"
              label="Quiet hours"
              sub="Silence non-critical alerts overnight."
              control={
                <Switch
                  label="Quiet hours"
                  checked={s.quietHours}
                  onChange={(quietHours) => patch({ quietHours })}
                />
              }
            />,
          ],
        },
      ];
    case "debug":
      return [
        {
          title: "Overlays",
          rows: [
            <RowShell
              key="fps"
              label="FPS meter"
              sub="Show the live frame-rate readout."
              control={
                <Switch
                  label="FPS meter"
                  checked={s.showFps}
                  onChange={(showFps) => patch({ showFps })}
                />
              }
            />,
            <RowShell
              key="badge"
              label="Build badge"
              sub="Show the build hash + age readout."
              control={
                <Switch
                  label="Build badge"
                  checked={s.showBuildBadge}
                  onChange={(showBuildBadge) => patch({ showBuildBadge })}
                />
              }
            />,
          ],
        },
        {
          title: "Diagnostics",
          rows: [
            <RowShell
              key="logs"
              label="Logs"
              sub="On-device frontend log viewer."
              control={
                <button type="button" style={ACTION_BUTTON}>
                  View logs
                </button>
              }
            />,
            <RowShell
              key="reset"
              label="Reset settings"
              sub="Restore every setting to its default."
              control={
                <button type="button" style={ACTION_BUTTON}>
                  Reset
                </button>
              }
            />,
          ],
        },
      ];
    case "about":
      return [
        {
          title: "Build",
          rows: [
            <RowShell
              key="sha"
              label="Version"
              control={<span style={VALUE_TEXT}>ff26b8b · 2h old</span>}
            />,
            <RowShell
              key="app"
              label="App build"
              control={<span style={VALUE_TEXT}>TestFlight 118</span>}
            />,
            <RowShell
              key="device"
              label="Hardware"
              control={<span style={VALUE_TEXT}>iPad Pro 12.9" (1366×1024)</span>}
            />,
          ],
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Frame , every concept renders inside the fixed board footprint with a
// shared "back to board" header affordance.
// ---------------------------------------------------------------------------

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div
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

function BackButton() {
  return (
    <button
      type="button"
      aria-label="Back to board"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 38,
        height: 38,
        padding: 0,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        borderRadius: 12,
        color: "var(--ink-2)",
        cursor: "pointer",
        flexShrink: 0,
        transform: "rotate(180deg)",
      }}
    >
      <Icon name="chevron" s={20} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Concept A , "Grouped cards" (iOS Settings)
// ---------------------------------------------------------------------------

export function SettingsConceptGroupedCards() {
  const { s, patch } = useDemoSettings();
  const [page, setPage] = useState<PageKey>("display");
  const blocks = pageBlocks(page, s, patch);
  const active = PAGE_BY_KEY[page];

  return (
    <PageFrame>
      {/* Sidebar */}
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
          <BackButton />
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Settings</h1>
        </div>
        <nav
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
          aria-label="Settings pages"
        >
          {PAGES.map((p) => {
            const selected = p.key === page;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPage(p.key)}
                aria-current={selected ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "10px 12px",
                  background: selected ? "var(--nest)" : "transparent",
                  border: selected ? "1px solid var(--hair-2)" : "1px solid transparent",
                  borderRadius: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: p.tint,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name={p.icon} s={19} sw={2} />
                </span>
                <span
                  style={{ fontFamily: "var(--ui)", fontSize: 16, color: "var(--ink)", flex: 1 }}
                >
                  {p.label}
                </span>
                <span style={{ color: "var(--ink-3)" }}>
                  <Icon name="chevron" s={16} />
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
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
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 650 }}>{active.label}</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-3)" }}>{active.blurb}</p>
          </div>
          {blocks.map((block) => (
            <section key={block.title}>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ink-3)",
                  margin: "0 4px 8px",
                }}
              >
                {block.title}
              </div>
              {/* Inset grouped card: rows separated by hairlines. */}
              <div
                style={{
                  background: "var(--tile)",
                  border: "1px solid var(--hair)",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                {block.rows.map((row, i) => (
                  <div
                    key={row.key}
                    style={{
                      padding: "14px 20px",
                      borderTop: i === 0 ? "none" : "1px solid var(--hair)",
                    }}
                  >
                    {row}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

// ---------------------------------------------------------------------------
// Concept B , "Icon rail" (Linear/Vercel flat column)
// ---------------------------------------------------------------------------

export function SettingsConceptIconRail() {
  const { s, patch } = useDemoSettings();
  const [page, setPage] = useState<PageKey>("display");
  const blocks = pageBlocks(page, s, patch);
  const active = PAGE_BY_KEY[page];

  return (
    <PageFrame>
      {/* Icon rail */}
      <div
        style={{
          width: 84,
          flexShrink: 0,
          borderRight: "1px solid var(--hair)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "20px 0",
          gap: 8,
        }}
      >
        {PAGES.map((p) => {
          const selected = p.key === page;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPage(p.key)}
              aria-label={p.label}
              aria-current={selected ? "page" : undefined}
              title={p.label}
              style={{
                width: 52,
                height: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: selected ? "var(--nest)" : "transparent",
                border: selected ? "1px solid var(--hair-2)" : "1px solid transparent",
                borderRadius: 14,
                color: selected ? "var(--ink)" : "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              <Icon name={p.icon} s={22} />
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="Back to board"
          style={{
            width: 52,
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 14,
            color: "var(--ink-2)",
            cursor: "pointer",
            transform: "rotate(180deg)",
          }}
        >
          <Icon name="chevron" s={20} />
        </button>
      </div>

      {/* Flat centered column */}
      <div style={{ flex: 1, overflowY: "auto", padding: "56px 0" }}>
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 40,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700 }}>{active.label}</h1>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--ink-2)" }}>{active.blurb}</p>
          </div>
          {blocks.map((block) => (
            <section
              key={block.title}
              style={{ display: "flex", flexDirection: "column", gap: 18 }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--ink)",
                  paddingBottom: 10,
                  borderBottom: "1px solid var(--hair)",
                }}
              >
                {block.title}
              </div>
              {block.rows.map((row) => (
                <div key={row.key}>{row}</div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

// ---------------------------------------------------------------------------
// Concept C , "Split detail" (descriptive sidebar + two-column card grid)
// ---------------------------------------------------------------------------

export function SettingsConceptSplitDetail() {
  const { s, patch } = useDemoSettings();
  const [page, setPage] = useState<PageKey>("display");
  const blocks = pageBlocks(page, s, patch);
  const active = PAGE_BY_KEY[page];

  return (
    <PageFrame>
      {/* Descriptive sidebar */}
      <div
        style={{
          width: 380,
          flexShrink: 0,
          borderRight: "1px solid var(--hair)",
          display: "flex",
          flexDirection: "column",
          padding: 28,
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BackButton />
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Settings</h1>
        </div>
        <nav
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
          aria-label="Settings pages"
        >
          {PAGES.map((p) => {
            const selected = p.key === page;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPage(p.key)}
                aria-current={selected ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "12px 14px",
                  background: selected ? "var(--tile-2)" : "transparent",
                  border: `1px solid ${selected ? "var(--hair-2)" : "transparent"}`,
                  borderRadius: 14,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: selected ? "var(--ink)" : "var(--ink-3)", marginTop: 2 }}>
                  <Icon name={p.icon} s={20} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span
                    style={{ fontSize: 15, color: "var(--ink)", fontWeight: selected ? 600 : 400 }}
                  >
                    {p.label}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{p.blurb}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Two-column card grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "36px 44px" }}>
        <h2 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 650 }}>{active.label}</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 20,
            alignItems: "start",
          }}
        >
          {blocks.map((block) => (
            <section
              key={block.title}
              style={{
                background: "var(--tile)",
                border: "1px solid var(--hair)",
                borderRadius: "var(--r)",
                padding: 22,
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ink-3)",
                }}
              >
                {block.title}
              </div>
              {block.rows.map((row) => (
                <div key={row.key}>{row}</div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}
