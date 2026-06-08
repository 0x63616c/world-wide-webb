/* ============================================================
   COMPONENT LIBRARY — Storybook-style catalog of the real
   control-center design system (ported from 0x63616c/control-center).
   ============================================================ */
var useState = React.useState;

/* ---------- catalog scaffolding ---------- */
function Story({ label, w, h, pad = 18, dark, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          position: "relative",
          borderRadius: 14,
          border: "1px solid var(--hair)",
          background: dark ? "#060708" : "var(--bg)",
          padding: pad,
          display: "grid",
          placeItems: "center",
          minHeight: h ? undefined : 96,
        }}
      >
        <div style={{ width: w, height: h }}>{children}</div>
      </div>
      <span
        style={{ font: "500 11px var(--mono)", color: "var(--ink-3)", letterSpacing: "0.04em" }}
      >
        {label}
      </span>
    </div>
  );
}

function Entry({ id, name, story, desc, props, children }) {
  return (
    <section id={id} style={{ scrollMarginTop: 30, marginBottom: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 5 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
          }}
        >
          {name}
        </h3>
        {story && (
          <span style={{ font: "400 12px var(--mono)", color: "var(--ink-3)" }}>{story}</span>
        )}
      </div>
      <p
        style={{
          margin: "0 0 8px",
          maxWidth: 760,
          color: "var(--ink-2)",
          fontSize: 13.5,
          lineHeight: 1.55,
        }}
      >
        {desc}
      </p>
      {props && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
          {props.map((p) => (
            <code
              key={p}
              style={{
                font: "400 11px var(--mono)",
                color: "var(--ink-2)",
                background: "var(--tile-2)",
                border: "1px solid var(--hair)",
                borderRadius: 6,
                padding: "3px 7px",
              }}
            >
              {p}
            </code>
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "24px 22px",
          alignItems: "flex-start",
          marginTop: props ? 0 : 14,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function GroupTitle({ children }) {
  return (
    <div
      style={{
        font: "600 11.5px var(--ui)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-3)",
        margin: "10px 0 22px",
        paddingBottom: 13,
        borderBottom: "1px solid var(--hair-2)",
      }}
    >
      {children}
    </div>
  );
}

/* ================= FOUNDATIONS ================= */
const COLORS = [
  ["--bg", "#000000", "stage"],
  ["--tile", "#0a0a0a", "card surface"],
  ["--tile-2", "#111111", "nested control"],
  ["--nest", "#181818", "deepest inset"],
  ["--ink", "#ededed", "primary text"],
  ["--ink-2", "#a1a1a1", "secondary"],
  ["--ink-3", "#6e6e6e", "muted labels"],
  ["--acc", "#0070f3", "accent (Vercel blue)"],
  ["--acc-2", "#0061d5", "accent pressed"],
  ["--acc-dim", "rgba(0,112,243,.14)", "active fill"],
  ["--acc-line", "rgba(0,112,243,.45)", "active border"],
  ["--amber", "#f4c063", "warning only"],
];
function Colors() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
      {COLORS.map(([tok, val, use]) => (
        <div
          key={tok}
          style={{
            borderRadius: 12,
            border: "1px solid var(--hair)",
            overflow: "hidden",
            background: "var(--tile)",
          }}
        >
          <div style={{ height: 72, background: val, borderBottom: "1px solid var(--hair)" }} />
          <div style={{ padding: "10px 12px" }}>
            <div style={{ font: "400 12px var(--mono)", color: "var(--ink)" }}>{tok}</div>
            <div style={{ font: "400 10.5px var(--mono)", color: "var(--ink-3)", marginTop: 3 }}>
              {val}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 6 }}>{use}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const TYPE = [
  ["Hero numeral", "69", "mono", 60, 700],
  ["Tile title", "Now Playing", "ui", 17.5, 600],
  ["Stat value", "38,752", "mono", 22, 700],
  ["Body", "Tap to view feed", "ui", 14, 400],
  ["Pill / status", "PLAYING", "ui", 12.5, 500],
  ["Caption label", "RANGE · ODOMETER", "cap", 10.5, 600],
];
function Typography() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", maxWidth: 820 }}>
      {TYPE.map(([role, sample, fam, size, weight]) => (
        <div
          key={role}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 20,
            padding: "14px 0",
            borderBottom: "1px solid var(--hair)",
          }}
        >
          <div style={{ width: 150, flex: "none" }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 500 }}>{role}</div>
            <div style={{ font: "400 10.5px var(--mono)", color: "var(--ink-3)", marginTop: 3 }}>
              {fam === "mono" ? "Space Mono" : "Space Grotesk"} · {size}px · {weight}
            </div>
          </div>
          <div
            className={fam === "mono" ? "mono" : fam === "cap" ? "cap" : undefined}
            style={{
              fontSize: size,
              fontWeight: weight,
              color: "var(--ink)",
              letterSpacing: fam === "cap" ? "0.16em" : fam === "mono" ? "-0.02em" : "-0.015em",
              textTransform: fam === "cap" ? "uppercase" : "none",
            }}
          >
            {sample}
          </div>
        </div>
      ))}
    </div>
  );
}

function Radii() {
  const items = [
    ["--r", "20px", "cards"],
    ["15px", "15px", "control tap"],
    ["14px", "14px", "feed / mini-card"],
    ["11px", "11px", "mode chip"],
    ["999px", "999px", "pill / switch"],
  ];
  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
      {items.map(([tok, val, use]) => (
        <div key={use} style={{ textAlign: "center" }}>
          <div
            style={{
              width: 84,
              height: 84,
              background: "var(--tile-2)",
              border: "1px solid var(--hair-2)",
              borderRadius: val === "20px" ? "var(--r)" : val,
            }}
          />
          <div style={{ font: "400 11px var(--mono)", color: "var(--ink-2)", marginTop: 9 }}>
            {val}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{use}</div>
        </div>
      ))}
    </div>
  );
}

function Icons() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(8,1fr)",
        gap: 12,
        width: "100%",
        maxWidth: 880,
      }}
    >
      {ICON_NAMES.map((n) => (
        <div
          key={n}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            padding: "16px 8px",
            borderRadius: 12,
            background: "var(--tile)",
            border: "1px solid var(--hair)",
          }}
        >
          <Icon name={n} s={24} c="var(--ink-2)" />
          <span style={{ font: "400 10px var(--mono)", color: "var(--ink-3)" }}>{n}</span>
        </div>
      ))}
    </div>
  );
}

/* ================= COMPONENT STORIES ================= */
function TileStories() {
  return (
    <Entry
      id="tile"
      name="Tile"
      story="UI/Tile"
      desc="The card surface every board tile is built on — --tile background, 1px --hair border, 20px radius, a faint inner top-light and a soft drop shadow. Hover lifts the border to --hair-2; the tile under the viewport crosshair gets --hair-3."
      props={["padding", "className", "onClick"]}
    >
      <Story label="Default · padding 20" w={300} h={150}>
        <Tile padding={20}>
          <TileHeader icon="wifi" title="Tile preview" />
          <div style={{ color: "var(--ink-2)", fontSize: 13 }}>
            Composed from shared primitives.
          </div>
        </Tile>
      </Story>
      <Story label="Custom padding · 28" w={300} h={150}>
        <Tile padding={28}>
          <TileHeader icon="thermo" title="Roomier" />
        </Tile>
      </Story>
      <Story label="ghost (placeholder)" w={300} h={150}>
        <Tile padding={20} className="ghost">
          <span className="cap">empty slot</span>
        </Tile>
      </Story>
    </Entry>
  );
}

function TileHeaderStories() {
  return (
    <Entry
      id="tileheader"
      name="TileHeader"
      story="UI/TileHeader"
      desc="Icon + title row at the top of a tile, with an optional right slot (pushed with margin-left:auto). Icon 19px --ink-2, title 17.5px / 600 / -0.015em. 16px margin below."
      props={["icon", "title", "right", "iconSize", "titleSize"]}
    >
      <Story label="title only" w={300}>
        <Tile padding={18}>
          <TileHeader icon="car" title="Tesla" />
        </Tile>
      </Story>
      <Story label="with right pill" w={300}>
        <Tile padding={18}>
          <TileHeader
            icon="car"
            title="Tesla"
            right={
              <Pill>
                <Icon name="lock" s={13} c="var(--ink-2)" />
                &nbsp;Locked
              </Pill>
            }
          />
        </Tile>
      </Story>
      <Story label="status pill (on)" w={300}>
        <Tile padding={18}>
          <TileHeader icon="thermo" title="Climate · A/C" right={<Pill tone="on">Cooling</Pill>} />
        </Tile>
      </Story>
    </Entry>
  );
}

function PillStories() {
  return (
    <Entry
      id="pill"
      name="Pill"
      story="UI/Pill"
      desc="Small rounded status chip. Three tones: Default (neutral --nest), On (accent fill + border), Amber (rare warning). Often paired with a live StatusDot."
      props={["tone: default | on | amber"]}
    >
      <Story label="Default">
        <Pill>Idle</Pill>
      </Story>
      <Story label="On">
        <Pill tone="on">Playing</Pill>
      </Story>
      <Story label="Amber">
        <Pill tone="amber">Offline</Pill>
      </Story>
      <Story label="with live dot">
        <Pill tone="on">
          <StatusDot online />
          &nbsp;Live
        </Pill>
      </Story>
      <Story label="with icon">
        <Pill>
          <Icon name="wifi" s={13} c="var(--ink-2)" />
          &nbsp;3ms
        </Pill>
      </Story>
    </Entry>
  );
}

function StatStories() {
  return (
    <Entry
      id="stat"
      name="Stat"
      story="UI/Stat"
      desc="A caption label stacked over a Space Mono value (22px / 700). The bottom-of-tile stat row pattern (e.g. Tesla’s RANGE / ODOMETER / CABIN). Supports accent and muted value colors plus an optional sub-line."
      props={["label", "value", "accent", "muted", "sub"]}
    >
      <Story label="default" w={150}>
        <div style={{ display: "flex", gap: 28 }}>
          <Stat label="Range" value="155 mi" />
        </div>
      </Story>
      <Story label="accent" w={120}>
        <Stat label="Now" value="74°" accent />
      </Story>
      <Story label="muted (idle)" w={120}>
        <Stat label="Cabin" value="—" muted />
      </Story>
      <Story label="with sub" w={150}>
        <Stat label="Odometer" value="38,752" sub="last synced 2m ago" />
      </Story>
      <Story label="row" w={300}>
        <div style={{ display: "flex", gap: 32 }}>
          <Stat label="Range" value="155 mi" />
          <Stat label="Odo" value="38,752" />
          <Stat label="Cabin" value="81°F" accent />
        </div>
      </Story>
    </Entry>
  );
}

function StatusDotStories() {
  return (
    <Entry
      id="statusdot"
      name="StatusDot"
      story="UI/StatusDot"
      desc="A single state indicator dot. Online pulses with the accent ‘pulse’ keyframe (2.4s); offline is a static --ink-3 dot."
      props={["online"]}
    >
      <Story label="online (pulsing)">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot online />
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Connected</span>
        </div>
      </Story>
      <Story label="offline">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot />
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>Disconnected</span>
        </div>
      </Story>
    </Entry>
  );
}

function SkeletonStories() {
  return (
    <Entry
      id="skeleton"
      name="Skeleton"
      story="UI/Skeleton"
      desc="Shimmer placeholder shown while a tile’s query is unresolved — the system never renders a fake value, it shimmers and recovers when data returns. Shimmer keyframe runs 1.6s linear."
      props={["w", "h", "borderRadius"]}
    >
      <Story label="lines" w={240}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton w="60%" />
          <Skeleton w="40%" />
        </div>
      </Story>
      <Story label="block" w={240}>
        <Skeleton w="100%" h={64} borderRadius={12} />
      </Story>
      <Story label="tile fallback" w={240} h={120}>
        <Tile padding={16}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton w="60%" />
            <Skeleton w="40%" />
          </div>
        </Tile>
      </Story>
    </Entry>
  );
}

function ChipStories() {
  function Demo() {
    const [m, setM] = useState("Cool");
    return (
      <div style={{ display: "flex", gap: 8, width: 360 }}>
        {["Cool", "Heat", "Heat·Cool", "Off"].map((x) => (
          <Chip key={x} active={m === x} onClick={() => setM(x)}>
            {x}
          </Chip>
        ))}
      </div>
    );
  }
  return (
    <Entry
      id="chip"
      name="Chip"
      story="UI/Chip (mode toggle)"
      desc="A segmented mode toggle (Climate’s Cool / Heat / Heat-Cool / Off). Each chip flexes to fill; the active one gets the accent dim fill + line. Tap to switch — try it."
      props={["active", "onClick"]}
    >
      <Story label="interactive group" w={360}>
        <Demo />
      </Story>
    </Entry>
  );
}

function ControlTapStories() {
  function Live({ icon, label, swatch, sub }) {
    const [on, setOn] = useState(true);
    return (
      <div style={{ width: 200, height: 120, borderRadius: 16, overflow: "hidden" }}>
        <ControlTap
          icon={icon}
          label={label}
          on={on}
          swatch={swatch}
          sub={sub}
          onToggle={() => setOn((v) => !v)}
        />
      </div>
    );
  }
  return (
    <Entry
      id="controltap"
      name="ControlTap"
      story="UI/ControlTap"
      desc="The control mini-card (Controls tile: Lamps / Lights / Fan). Icon top-left + status dot top-right, label + ON/OFF at the bottom baseline. Fan spins while on; a swatch circle replaces the icon for scene colors; disabled dims to 0.4."
      props={["icon: lamp|bulb|fan", "on", "sub", "pending", "swatch", "disabled", "onToggle"]}
    >
      <Story label="On (tap to toggle)">
        <Live icon="lamp" label="Lamps" />
      </Story>
      <Story label="Off">
        <div style={{ width: 200, height: 120, borderRadius: 16, overflow: "hidden" }}>
          <ControlTap icon="bulb" label="Lights" on={false} onToggle={() => {}} />
        </div>
      </Story>
      <Story label="Fan (spins on)">
        <Live icon="fan" label="Fan" />
      </Story>
      <Story label="Swatch · color">
        <div style={{ width: 200, height: 120, borderRadius: 16, overflow: "hidden" }}>
          <ControlTap icon="bulb" label="Blue" on swatch="rgb(0,0,255)" onToggle={() => {}} />
        </div>
      </Story>
      <Story label="Swatch · warm white">
        <div style={{ width: 200, height: 120, borderRadius: 16, overflow: "hidden" }}>
          <ControlTap icon="bulb" label="White" on swatch="rgb(255,244,224)" onToggle={() => {}} />
        </div>
      </Story>
      <Story label="Disabled">
        <div style={{ width: 200, height: 120, borderRadius: 16, overflow: "hidden" }}>
          <ControlTap icon="lamp" label="Party" on={false} disabled onToggle={() => {}} />
        </div>
      </Story>
      <Story label="Pending (0.7)">
        <div style={{ width: 200, height: 120, borderRadius: 16, overflow: "hidden" }}>
          <ControlTap icon="lamp" label="Lamps" on pending onToggle={() => {}} />
        </div>
      </Story>
    </Entry>
  );
}

function SwitchStories() {
  function Demo() {
    const [on, setOn] = useState(true);
    return <Switch on={on} onToggle={() => setOn((v) => !v)} />;
  }
  return (
    <Entry
      id="switch"
      name="Switch"
      story=".sw (token CSS)"
      desc="The toggle switch — a CSS-only control in tokens.css. Off is a neutral track with an --ink-2 knob; on fills --acc-dim with an accent knob that glows and slides on a springy cubic-bezier."
      props={["on", "onToggle"]}
    >
      <Story label="On (tap)">
        <Demo />
      </Story>
      <Story label="Off">
        <Switch on={false} onToggle={() => {}} />
      </Story>
    </Entry>
  );
}

function RangeStories() {
  function Demo({ lg }) {
    const [v, setV] = useState(48);
    return (
      <div style={{ width: 320 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="cap">{lg ? "Lamp brightness" : "Volume"}</span>
          <span className="mono" style={{ color: "var(--acc)", fontSize: 13 }}>
            {v}%
          </span>
        </div>
        <Range value={v} onChange={setV} lg={lg} />
      </div>
    );
  }
  return (
    <Entry
      id="range"
      name="Range / Slider"
      story=".range (token CSS)"
      desc="The volume / scrub / brightness slider. Native input styled by the token CSS: the track fills --acc up to the value (driven by a --p custom property), with a white thumb ringed by the tile color. range-lg is the taller hero variant (lamp brightness)."
      props={["value", "onChange", "min", "max", "lg"]}
    >
      <Story label="standard (drag)" w={320}>
        <Demo />
      </Story>
      <Story label="range-lg (drag)" w={320}>
        <Demo lg />
      </Story>
    </Entry>
  );
}

function BorderRingStories() {
  return (
    <Entry
      id="ring"
      name="BorderProgressRing"
      story="UI/BorderProgressRing"
      desc="A progress stroke traced along the rounded-rect border of any relative-positioned box. Measures the host at runtime so the stroke hugs the real border at any size — used for the clock seconds ring and tile-level progress."
      props={["progress 0..1", "strokeWidth", "color", "trackColor", "direction"]}
    >
      <Story label="progress 0.65" w={150} h={150}>
        <div
          style={{
            position: "relative",
            width: 150,
            height: 150,
            borderRadius: "var(--r)",
            border: "1px solid var(--hair)",
            background: "var(--tile)",
          }}
        >
          <BorderProgressRing
            progress={0.65}
            width={150}
            height={150}
            radius={20}
            color="var(--acc)"
            trackColor="var(--nest)"
            strokeWidth={3}
          />
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: "var(--acc)" }}>
              65%
            </span>
          </div>
        </div>
      </Story>
      <Story label="full perimeter · 0.9" w={150} h={150}>
        <div
          style={{
            position: "relative",
            width: 150,
            height: 150,
            borderRadius: "var(--r)",
            border: "1px solid var(--hair)",
            background: "var(--tile)",
          }}
        >
          <BorderProgressRing
            progress={0.9}
            width={150}
            height={150}
            radius={20}
            color="var(--ink-2)"
            strokeWidth={2.5}
          />
        </div>
      </Story>
    </Entry>
  );
}

function ModalStories() {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(640);
  return (
    <Entry
      id="modal"
      name="Modal"
      story="UI/Modal"
      desc="The full-screen detail overlay: a dim backdrop (rgba 0,0,0,.55, click or Esc to close) and a centered fixed-size panel with a 34px rounded close button. Per-modal width / maxHeight, clamped to the 1366×1024 board. Entrance animation respects prefers-reduced-motion."
      props={["open", "onClose", "title", "width", "maxHeight"]}
    >
      <Story label="open the modal" w={300}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => {
              setW(640);
              setOpen(true);
            }}
            className="chip on"
            style={{ flex: "none", padding: "10px 18px" }}
          >
            Open · 640
          </button>
          <button
            onClick={() => {
              setW(880);
              setOpen(true);
            }}
            className="chip"
            style={{ flex: "none", padding: "10px 18px" }}
          >
            Open · 880 wide
          </button>
        </div>
      </Story>
      <Modal open={open} onClose={() => setOpen(false)} title="Weather" width={w} maxHeight={560}>
        <div style={{ padding: "8px 0", display: "flex", gap: 32 }}>
          <Stat label="Now" value="74°" accent />
          <Stat label="Feels" value="76°" />
          <Stat label="High" value="75°" />
          <Stat label="Low" value="62°" muted />
        </div>
        <p style={{ color: "var(--ink-2)", fontSize: 13.5, lineHeight: 1.6, marginTop: 16 }}>
          The panel portals to &lt;body&gt; (outside the pannable stage) so a drag on its controls
          never pans the board behind it. Press Esc, click the backdrop, or hit × to close.
        </p>
      </Modal>
    </Entry>
  );
}

/* ================= LAYOUT ================= */
const NAV = [
  [
    "Foundations",
    [
      ["color", "Color"],
      ["type", "Typography"],
      ["radius", "Radius"],
      ["icons", "Icons"],
    ],
  ],
  [
    "Components",
    [
      ["tile", "Tile"],
      ["tileheader", "TileHeader"],
      ["pill", "Pill"],
      ["stat", "Stat"],
      ["statusdot", "StatusDot"],
      ["skeleton", "Skeleton"],
      ["chip", "Chip"],
      ["controltap", "ControlTap"],
      ["switch", "Switch"],
      ["range", "Range"],
      ["ring", "BorderProgressRing"],
      ["modal", "Modal"],
    ],
  ],
];

function Library() {
  return (
    <div
      className="e-root"
      style={{ minHeight: "100vh", background: "#060708", color: "var(--ink)", display: "flex" }}
    >
      {/* sidebar */}
      <aside
        style={{
          width: 236,
          flex: "none",
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          height: "100vh",
          overflow: "auto",
          borderRight: "1px solid var(--hair)",
          padding: "30px 22px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            font: "600 12px var(--mono)",
            color: "var(--acc)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            marginBottom: 5,
          }}
        >
          Control Center
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 26 }}>
          Design System
        </div>
        {NAV.map(([group, items]) => (
          <div key={group} style={{ marginBottom: 22 }}>
            <div
              style={{
                font: "600 10.5px var(--ui)",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                marginBottom: 11,
              }}
            >
              {group}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {items.map(([id, label]) => (
                <a
                  key={id}
                  href={"#" + id}
                  style={{
                    textDecoration: "none",
                    color: "var(--ink-2)",
                    fontSize: 13.5,
                    padding: "6px 10px",
                    borderRadius: 8,
                    display: "block",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--tile-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        ))}
        <div
          style={{
            marginTop: 26,
            paddingTop: 18,
            borderTop: "1px solid var(--hair)",
            fontSize: 11.5,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          Ported from
          <br />
          <code style={{ font: "400 11px var(--mono)", color: "var(--ink-2)" }}>
            0x63616c/control-center
          </code>
          <br />
          <span style={{ color: "var(--ink-3)" }}>apps/web/src/components/ui</span>
        </div>
      </aside>

      {/* main */}
      <main style={{ flex: 1, minWidth: 0, padding: "46px 54px 120px", maxWidth: 1180 }}>
        <header style={{ marginBottom: 46 }}>
          <h1 style={{ margin: 0, fontSize: 38, fontWeight: 600, letterSpacing: "-0.035em" }}>
            Component Library
          </h1>
          <p
            style={{
              margin: "15px 0 0",
              maxWidth: 780,
              color: "var(--ink-2)",
              fontSize: 15,
              lineHeight: 1.6,
            }}
          >
            The shared primitives behind the wall-panel board, with every documented state — ported
            straight from the repo’s{" "}
            <code style={{ font: "400 13px var(--mono)", color: "var(--ink)" }}>ui/</code> layer and
            Storybook stories. Same tokens, same class names, same icon set. Live controls are
            interactive; the Modal opens for real.
          </p>
        </header>

        <GroupTitle>Foundations</GroupTitle>
        <Entry
          id="color"
          name="Color"
          desc="Vercel-black neutral grayscale surfaces (no blue tint) with a Geist-style foreground ramp; the single accent is Vercel blue. Amber is reserved for rare warnings."
        >
          <Colors />
        </Entry>
        <Entry
          id="type"
          name="Typography"
          desc="Space Grotesk for all UI text; Space Mono for every numeral — time, %, volume, duration, odometer. Tiny uppercase labels use the .cap class at 0.16em tracking."
        >
          <Typography />
        </Entry>
        <Entry
          id="radius"
          name="Radius"
          desc="20px (--r) for cards, stepping down through nested controls to fully-round pills and switches."
        >
          <Radii />
        </Entry>
        <Entry
          id="icons"
          name="Icons"
          desc="The full 23-glyph set from components/Icon.tsx — a single stroked 24×24 system (1.7 stroke, round caps/joins). Pass name, size, color, stroke width."
        >
          <Icons />
        </Entry>

        <GroupTitle>Components</GroupTitle>
        <TileStories />
        <TileHeaderStories />
        <PillStories />
        <StatStories />
        <StatusDotStories />
        <SkeletonStories />
        <ChipStories />
        <ControlTapStories />
        <SwitchStories />
        <RangeStories />
        <BorderRingStories />
        <ModalStories />
      </main>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<Library />);
