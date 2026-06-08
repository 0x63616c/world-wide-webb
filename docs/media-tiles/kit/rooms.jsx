/* ============================================================
   ROOMS / MULTI-ROOM MIXER — 6 tile archetypes (A–F) + 3 modals
   Live topology: Desk (coordinator) + Bedroom bonded on Line-in.
   Living Room (Beam) idle. Bathroom + Kitchen idle.
   Volumes: LR 70, Desk 66, Bedroom 68, Bathroom 68, Kitchen 53.
   ============================================================ */
var useState = React.useState;

const RM = [
  { n: "Living Room", dev: "Beam", vol: 70, src: "idle", state: "STOPPED", grp: null },
  {
    n: "Desk",
    dev: "Era 300 ×2",
    vol: 66,
    src: "Line-in",
    state: "PLAYING",
    grp: "A",
    coord: true,
  },
  { n: "Bedroom", dev: "Era 300", vol: 68, src: "Line-in", state: "PLAYING", grp: "A" },
  { n: "Bathroom", dev: "Era 100", vol: 68, src: "idle", state: "STOPPED", grp: null },
  { n: "Kitchen", dev: "Era 100 SL", vol: 53, src: "idle", state: "STOPPED", grp: null },
];
const short = {
  "Living Room": "Living",
  Desk: "Desk",
  Bedroom: "Bed",
  Bathroom: "Bath",
  Kitchen: "Kitchen",
};

/* source chip — accent when actively playing a source */
function SrcChip({ src, active }) {
  const idle = src === "idle";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 7,
        font: `500 10.5px ${T.ui}`,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        background: active ? T.accDim : T.tile2,
        color: idle ? T.ink3 : active ? T.acc : T.ink2,
        border: `1px solid ${active ? T.accLine : T.hair}`,
      }}
    >
      {!idle && (
        <span
          style={{ width: 5, height: 5, borderRadius: 99, background: active ? T.acc : T.ink2 }}
        />
      )}
      {idle ? "IDLE" : src}
    </span>
  );
}

/* vertical fader */
function VFader({ pct, h = 132, accent = true, muted = false, knob = 18, w = 8 }) {
  return (
    <div
      style={{ position: "relative", width: w, height: h, borderRadius: 99, background: T.nest }}
    >
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${pct}%`,
          borderRadius: 99,
          background: muted ? T.ink3 : accent ? T.acc : T.ink2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: `calc(${pct}% - ${knob / 2}px)`,
          transform: "translateX(-50%)",
          width: knob,
          height: knob,
          borderRadius: 99,
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  );
}

/* group link rail — accent vertical bracket marking bonded rooms */
function LinkRail({ h }) {
  return (
    <div style={{ position: "relative", width: 14, flex: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 6,
          top: 14,
          bottom: 14,
          width: 2,
          background: T.accLine,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 6,
          top: 14,
          width: 8,
          height: 2,
          background: T.accLine,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 6,
          bottom: 14,
          width: 8,
          height: 2,
          background: T.accLine,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 2,
          top: "50%",
          transform: "translateY(-50%)",
          width: 10,
          height: 10,
          borderRadius: 99,
          background: T.acc,
          boxShadow: T.accGlow,
        }}
      />
    </div>
  );
}

/* ---------------- A · Horizontal fader strip (4×3) ---------------- */
function RoomsA() {
  const [rooms, setRooms] = useState(RM);
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            1 GROUP
          </Pill>
        }
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {rooms.map((r, i) => {
          const inGrp = r.grp === "A";
          return (
            <div key={r.n} style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 96, flex: "none" }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: r.state === "PLAYING" ? T.ink : T.ink2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {inGrp && (
                    <span style={{ width: 5, height: 5, borderRadius: 99, background: T.acc }} />
                  )}
                  {r.n}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <Slider pct={r.vol} accent={r.state === "PLAYING"} knob={14} />
              </div>
              <span
                style={{
                  font: `400 12.5px ${T.mono}`,
                  color: r.state === "PLAYING" ? T.ink : T.ink3,
                  width: 26,
                  textAlign: "right",
                }}
              >
                {r.vol}
              </span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- B · Vertical fader console (4×3) ---------------- */
function RoomsB() {
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            1 GROUP
          </Pill>
        }
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          paddingTop: 6,
        }}
      >
        {RM.map((r) => {
          const playing = r.state === "PLAYING";
          return (
            <div
              key={r.n}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 9,
                width: 64,
              }}
            >
              <span style={{ font: `400 12.5px ${T.mono}`, color: playing ? T.ink : T.ink3 }}>
                {r.vol}
              </span>
              <VFader pct={r.vol} h={132} accent={playing} />
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: playing ? T.ink : T.ink2,
                    marginBottom: 4,
                  }}
                >
                  {short[r.n]}
                </div>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    display: "inline-block",
                    background: playing ? T.acc : r.grp ? T.acc : T.ink3,
                    opacity: playing ? 1 : r.grp ? 0.5 : 1,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- C · Compact list rows (3×4 tall) ---------------- */
function RoomsC() {
  return (
    <Tile w={319} h={431}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            1 GRP
          </Pill>
        }
        mb={14}
      />
      {/* master group volume */}
      <div
        style={{
          padding: "12px 12px",
          background: T.tile2,
          border: `1px solid ${T.hair}`,
          borderRadius: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
          <Label style={{ color: T.ink2 }}>All Speakers</Label>
          <span style={{ font: `400 12px ${T.mono}`, color: T.ink }}>64</span>
        </div>
        <Slider pct={64} knob={14} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {RM.map((r) => {
          const playing = r.state === "PLAYING";
          return (
            <div key={r.n}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: playing ? T.ink : T.ink2 }}>
                  {r.n}
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <SrcChip src={r.src} active={playing} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ flex: 1 }}>
                  <Slider pct={r.vol} accent={playing} knob={13} />
                </div>
                <span
                  style={{
                    font: `400 12px ${T.mono}`,
                    color: playing ? T.ink : T.ink3,
                    width: 24,
                    textAlign: "right",
                  }}
                >
                  {r.vol}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- D · Room chips that expand (4×3) ---------------- */
function RoomsD() {
  const [open, setOpen] = useState("Desk");
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            1 GROUP
          </Pill>
        }
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {RM.map((r) => {
          const playing = r.state === "PLAYING";
          const isOpen = open === r.n;
          return (
            <div
              key={r.n}
              onClick={() => setOpen(r.n)}
              style={{
                cursor: "pointer",
                width: isOpen ? "100%" : "calc(50% - 5px)",
                boxSizing: "border-box",
                padding: "12px 13px",
                borderRadius: 13,
                background: playing ? T.accDim : T.tile2,
                border: `1px solid ${playing ? T.accLine : T.hair}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: playing ? T.ink : T.ink2 }}>
                  {r.n}
                </span>
                {r.grp && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      background: T.acc,
                      marginLeft: -2,
                    }}
                  />
                )}
                <span
                  style={{
                    marginLeft: "auto",
                    font: `400 13px ${T.mono}`,
                    color: playing ? T.acc : T.ink3,
                  }}
                >
                  {r.vol}
                </span>
              </div>
              {isOpen ? (
                <div style={{ marginTop: 11 }}>
                  <Slider pct={r.vol} accent={playing} knob={15} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9 }}>
                    <SrcChip src={r.src} active={playing} />
                    <span style={{ fontSize: 11.5, color: T.ink3 }}>{r.dev}</span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: T.ink3, marginTop: 5 }}>
                  {r.src === "idle" ? "Idle" : r.src}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- E · House-map layout (4×3) ---------------- */
function MapCell({ r, style }) {
  const playing = r.state === "PLAYING";
  return (
    <div
      style={{
        position: "relative",
        padding: "11px 12px",
        borderRadius: 12,
        background: playing ? T.accDim : T.tile2,
        border: `1px solid ${playing ? T.accLine : T.hair}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: playing ? T.acc : T.ink3,
            flex: "none",
          }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: playing ? T.ink : T.ink2 }}>
          {r.n}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ font: `400 16px ${T.mono}`, color: playing ? T.ink : T.ink3 }}>{r.vol}</span>
        <span
          style={{
            fontSize: 10,
            color: T.ink3,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {r.src === "idle" ? "idle" : r.src}
        </span>
      </div>
    </div>
  );
}
function RoomsE() {
  const get = (n) => RM.find((r) => r.n === n);
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.home({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            HOUSE
          </Pill>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 9,
          height: 214,
        }}
      >
        <MapCell r={get("Living Room")} style={{ gridRow: "1 / span 2" }} />
        <MapCell r={get("Desk")} />
        <MapCell r={get("Kitchen")} />
        <MapCell r={get("Bedroom")} />
        <MapCell r={get("Bathroom")} />
      </div>
    </Tile>
  );
}

/* ---------------- F · Grouped stack (3×4 tall) ---------------- */
function RoomsF() {
  const grouped = RM.filter((r) => r.grp === "A");
  const solo = RM.filter((r) => !r.grp);
  return (
    <Tile w={319} h={431}>
      <Header
        icon={I.link({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            1 GRP
          </Pill>
        }
        mb={14}
      />
      {/* bonded group card */}
      <div
        style={{
          borderRadius: 14,
          border: `1px solid ${T.accLine}`,
          background: T.accDim,
          padding: "13px 13px",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {I.link({ size: 15, c: T.acc })}
          <span
            style={{
              font: `600 11px ${T.ui}`,
              color: T.acc,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Group · Line-in
          </span>
          <span style={{ marginLeft: "auto", font: `400 12px ${T.mono}`, color: T.acc }}>67</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <LinkRail />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            {grouped.map((r) => (
              <div key={r.n}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{r.n}</span>
                  {r.coord && (
                    <span
                      style={{
                        font: `500 9px ${T.ui}`,
                        color: T.acc,
                        letterSpacing: "0.08em",
                        padding: "2px 5px",
                        border: `1px solid ${T.accLine}`,
                        borderRadius: 5,
                      }}
                    >
                      COORD
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", font: `400 12px ${T.mono}`, color: T.ink2 }}>
                    {r.vol}
                  </span>
                </div>
                <Slider pct={r.vol} accent knob={12} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* ungrouped */}
      <Label style={{ marginBottom: 11 }}>Ungrouped</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {solo.map((r) => (
          <div key={r.n}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink2 }}>{r.n}</span>
              <span style={{ marginLeft: "auto", font: `400 12px ${T.mono}`, color: T.ink3 }}>
                {r.vol}
              </span>
            </div>
            <Slider pct={r.vol} accent={false} knob={12} />
          </div>
        ))}
      </div>
    </Tile>
  );
}

/* ---------------- G · Rotary dials (4×3) ---------------- */
function Dial({ r, size = 74 }) {
  const playing = r.state === "PLAYING";
  const sw = 6,
    R = size / 2 - sw / 2 - 2,
    C = 2 * Math.PI * R,
    arc = 0.75,
    pct = r.vol / 100;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 9,
        width: size,
      }}
    >
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(135deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke={T.nest}
            strokeWidth={sw}
            strokeDasharray={`${arc * C} ${C}`}
            strokeLinecap="round"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke={playing ? T.acc : T.ink2}
            strokeWidth={sw}
            strokeDasharray={`${arc * C * pct} ${C}`}
            strokeLinecap="round"
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <span style={{ font: `400 16px ${T.mono}`, color: playing ? T.ink : T.ink3 }}>
            {r.vol}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: playing ? T.ink : T.ink2 }}>
        {short[r.n]}
      </div>
    </div>
  );
}
function RoomsG() {
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            1 GROUP
          </Pill>
        }
      />
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 14 }}>
        {RM.map((r) => (
          <Dial key={r.n} r={r} />
        ))}
      </div>
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingTop: 16,
        }}
      >
        <Label style={{ color: T.ink2 }}>Group volume</Label>
        <div style={{ flex: 1 }}>
          <Slider pct={64} knob={14} />
        </div>
        <span style={{ font: `400 13px ${T.mono}`, color: T.ink }}>64</span>
      </div>
    </Tile>
  );
}

/* ---------------- H · Group hero + toggle pills (4×3) ---------------- */
function RoomsH() {
  const [grp, setGrp] = useState(["Desk", "Bedroom"]);
  const toggle = (n) => setGrp((g) => (g.includes(n) ? g.filter((x) => x !== n) : [...g, n]));
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            {grp.length} IN GROUP
          </Pill>
        }
      />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 11 }}>
        <span
          style={{
            font: `400 58px ${T.mono}`,
            color: T.ink,
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
          }}
        >
          64
        </span>
        <Label style={{ color: T.ink2, marginBottom: 8 }}>
          Group
          <br />
          volume
        </Label>
      </div>
      <div style={{ margin: "16px 0 20px" }}>
        <Slider pct={64} knob={18} h={5} />
      </div>
      <Label style={{ marginBottom: 11 }}>In this group — tap to add / remove</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {RM.map((r) => {
          const on = grp.includes(r.n);
          return (
            <button
              key={r.n}
              onClick={() => toggle(r.n)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 12px",
                borderRadius: 10,
                cursor: "pointer",
                font: `500 12.5px ${T.ui}`,
                background: on ? T.accDim : T.tile2,
                color: on ? T.ink : T.ink2,
                border: `1px solid ${on ? T.accLine : T.hair}`,
              }}
            >
              <span
                style={{ width: 6, height: 6, borderRadius: 99, background: on ? T.acc : T.ink3 }}
              />
              {r.n}
              <span style={{ font: `400 11.5px ${T.mono}`, color: on ? T.acc : T.ink3 }}>
                {r.vol}
              </span>
            </button>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- I · Segmented LED meters (4×3) ---------------- */
function Meter({ pct, on, blocks = 13 }) {
  const filled = Math.round((pct / 100) * blocks);
  return (
    <div style={{ display: "flex", gap: 3, flex: 1 }}>
      {Array.from({ length: blocks }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 16,
            borderRadius: 2,
            background: i < filled ? (on ? T.acc : T.ink2) : T.nest,
          }}
        />
      ))}
    </div>
  );
}
function RoomsI() {
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            1 GROUP
          </Pill>
        }
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4 }}>
        {RM.map((r) => {
          const on = r.state === "PLAYING";
          return (
            <div key={r.n} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{ width: 88, flex: "none", display: "flex", alignItems: "center", gap: 6 }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    flex: "none",
                    background: on ? T.acc : T.ink3,
                  }}
                />
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: on ? T.ink : T.ink2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {short[r.n]}
                </span>
              </div>
              <Meter pct={r.vol} on={on} />
              <span
                style={{
                  font: `400 12.5px ${T.mono}`,
                  color: on ? T.ink : T.ink3,
                  width: 24,
                  textAlign: "right",
                }}
              >
                {r.vol}
              </span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- J · Radial topology ring (4×3) ---------------- */
function RoomsJ() {
  const size = 178,
    cx = size / 2,
    cy = size / 2,
    R = 60,
    nodeR = 25;
  const nodes = RM.map((r, i) => {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    return { ...r, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.link({ size: 19 })}
        title="Rooms"
        right={
          <Pill active dot>
            TOPOLOGY
          </Pill>
        }
      />
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
          <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
            <circle cx={cx} cy={cy} r={R} fill="none" stroke={T.hair} strokeWidth="1" />
            {nodes
              .filter((n) => n.grp)
              .map((n) => (
                <line
                  key={n.n}
                  x1={cx}
                  y1={cy}
                  x2={n.x}
                  y2={n.y}
                  stroke={T.accLine}
                  strokeWidth="1.5"
                />
              ))}
          </svg>
          <div
            style={{
              position: "absolute",
              left: cx,
              top: cy,
              transform: "translate(-50%,-50%)",
              width: 54,
              height: 54,
              borderRadius: 99,
              background: T.accDim,
              border: `1px solid ${T.accLine}`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ font: `400 16px ${T.mono}`, color: T.acc, lineHeight: 1 }}>67</div>
              <div
                style={{
                  font: `600 7px ${T.ui}`,
                  color: T.acc,
                  letterSpacing: "0.1em",
                  marginTop: 2,
                }}
              >
                GROUP
              </div>
            </div>
          </div>
          {nodes.map((n) => {
            const playing = n.state === "PLAYING";
            return (
              <div
                key={n.n}
                style={{
                  position: "absolute",
                  left: n.x,
                  top: n.y,
                  transform: "translate(-50%,-50%)",
                  width: nodeR * 2,
                  height: nodeR * 2,
                  borderRadius: 99,
                  display: "grid",
                  placeItems: "center",
                  background: playing ? T.accDim : T.tile2,
                  border: `1px solid ${playing ? T.accLine : T.hair}`,
                }}
              >
                <span style={{ font: `400 12px ${T.mono}`, color: playing ? T.ink : T.ink3 }}>
                  {n.vol}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {RM.map((r) => {
            const playing = r.state === "PLAYING";
            return (
              <div
                key={r.n}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    flex: "none",
                    background: playing ? T.acc : T.ink3,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: playing ? T.ink : T.ink2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.n}
                </span>
                <span style={{ flex: "none", font: `400 12px ${T.mono}`, color: T.ink3 }}>
                  {r.vol}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Tile>
  );
}

/* =================== MODALS (960×680) =================== */

/* M1 · Mixer — vertical faders */
function ModalMixer() {
  const [mutes, setMutes] = useState({});
  return (
    <ModalPanel w={960} h={680} title="Mixer" icon={I.speaker({ size: 20 })}>
      <div style={{ display: "flex", gap: 18, height: "100%" }}>
        {/* master */}
        <div
          style={{
            width: 120,
            flex: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "18px 0",
            background: T.tile2,
            borderRadius: 16,
            border: `1px solid ${T.accLine}`,
          }}
        >
          <Label style={{ color: T.acc, marginBottom: 6 }}>All</Label>
          <span style={{ font: `400 18px ${T.mono}`, color: T.ink, marginBottom: 16 }}>64</span>
          <VFader pct={64} h={300} accent knob={24} w={10} />
          <button
            style={{
              marginTop: 18,
              padding: "8px 16px",
              borderRadius: 10,
              background: T.nest,
              border: `1px solid ${T.hair}`,
              color: T.ink2,
              font: `500 12px ${T.ui}`,
              cursor: "pointer",
            }}
          >
            Mute all
          </button>
        </div>
        {/* room channels */}
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "space-around",
            padding: "18px 0",
            background: T.tile2,
            borderRadius: 16,
            border: `1px solid ${T.hair}`,
          }}
        >
          {RM.map((r) => {
            const playing = r.state === "PLAYING";
            const muted = !!mutes[r.n];
            return (
              <div
                key={r.n}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
              >
                <span
                  style={{
                    font: `400 16px ${T.mono}`,
                    color: muted ? T.ink3 : playing ? T.ink : T.ink2,
                  }}
                >
                  {r.vol}
                </span>
                <VFader
                  pct={r.vol}
                  h={280}
                  accent={playing && !muted}
                  muted={muted}
                  knob={22}
                  w={9}
                />
                <button
                  onClick={() => setMutes((m) => ({ ...m, [r.n]: !m[r.n] }))}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    background: muted ? T.accDim : T.nest,
                    border: `1px solid ${muted ? T.accLine : T.hair}`,
                  }}
                >
                  {muted ? I.speakerMute({ size: 17, c: T.acc }) : I.speaker({ size: 17 })}
                </button>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: playing ? T.ink : T.ink2 }}>
                    {r.n}
                  </div>
                  <div style={{ fontSize: 11, color: T.ink3, marginTop: 3 }}>
                    {r.src === "idle" ? "Idle" : r.src}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalPanel>
  );
}

/* M2 · Group Builder — tap rooms to bond on a house map */
function ModalGroup() {
  const [grp, setGrp] = useState(["Desk", "Bedroom"]);
  const toggle = (n) => setGrp((g) => (g.includes(n) ? g.filter((x) => x !== n) : [...g, n]));
  const get = (n) => RM.find((r) => r.n === n);
  const Node = ({ n, style }) => {
    const r = get(n);
    const on = grp.includes(n);
    return (
      <div
        onClick={() => toggle(n)}
        style={{
          position: "relative",
          cursor: "pointer",
          padding: "14px 15px",
          borderRadius: 14,
          background: on ? T.accDim : T.tile2,
          border: `1.5px solid ${on ? T.accLine : T.hair}`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          ...style,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: on ? T.ink : T.ink2 }}>{r.n}</span>
          {on && grp[0] === n && (
            <span
              style={{
                font: `500 9px ${T.ui}`,
                color: T.acc,
                letterSpacing: "0.08em",
                padding: "2px 5px",
                border: `1px solid ${T.accLine}`,
                borderRadius: 5,
              }}
            >
              COORD
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: T.ink3 }}>{r.dev}</span>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background: on ? T.acc : "transparent",
              border: `1.5px solid ${on ? T.acc : T.hair2}`,
            }}
          >
            {on && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l5 5 9-11" />
              </svg>
            )}
          </span>
        </div>
      </div>
    );
  };
  return (
    <ModalPanel w={960} h={680} title="Group Builder" icon={I.link({ size: 20 })}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 14, color: T.ink2 }}>Tap rooms to bond into one group.</span>
          <Pill active dot style={{ marginLeft: "auto" }}>
            {grp.length} BONDED
          </Pill>
        </div>
        {/* schematic floor map */}
        <div
          style={{
            flex: 1,
            position: "relative",
            background: T.tile2,
            border: `1px solid ${T.hair}`,
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div style={{ position: "absolute", top: 14, left: 18 }}>
            <Label>Floor plan</Label>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 1fr 1fr",
              gridTemplateRows: "1fr 1fr",
              gap: 14,
              height: "100%",
              paddingTop: 18,
            }}
          >
            <Node n="Living Room" style={{ gridRow: "1 / span 2" }} />
            <Node n="Desk" />
            <Node n="Kitchen" />
            <Node n="Bedroom" />
            <Node n="Bathroom" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button
            style={{
              flex: 1,
              padding: "13px",
              borderRadius: 12,
              background: T.acc,
              border: "none",
              color: "#fff",
              font: `600 14px ${T.ui}`,
              cursor: "pointer",
              boxShadow: T.accGlow,
            }}
          >
            Save group
          </button>
          <button
            onClick={() => setGrp([])}
            style={{
              padding: "13px 22px",
              borderRadius: 12,
              background: T.tile2,
              border: `1px solid ${T.hair}`,
              color: T.ink2,
              font: `500 14px ${T.ui}`,
              cursor: "pointer",
            }}
          >
            Ungroup all
          </button>
        </div>
      </div>
    </ModalPanel>
  );
}

/* M3 · Per-room Source picker */
const SOURCES = ["Line-in", "TV", "Spotify", "AirPlay", "Idle"];
function ModalSource() {
  const [sel, setSel] = useState({
    "Living Room": "Idle",
    Desk: "Line-in",
    Bedroom: "Line-in",
    Bathroom: "Idle",
    Kitchen: "Idle",
  });
  return (
    <ModalPanel w={960} h={680} title="Per-room Source" icon={I.list({ size: 20 })}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          height: "100%",
          overflow: "auto",
        }}
      >
        {RM.map((r) => (
          <div
            key={r.n}
            style={{
              padding: "16px 18px",
              background: T.tile2,
              border: `1px solid ${T.hair}`,
              borderRadius: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{r.n}</span>
              <span style={{ fontSize: 12, color: T.ink3 }}>{r.dev}</span>
              {r.grp && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    marginLeft: 4,
                    font: `500 10px ${T.ui}`,
                    color: T.acc,
                    letterSpacing: "0.06em",
                    padding: "2px 7px",
                    border: `1px solid ${T.accLine}`,
                    borderRadius: 6,
                  }}
                >
                  {I.link({ size: 11, c: T.acc })} GROUPED
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SOURCES.map((s) => {
                const on = sel[r.n] === s;
                return (
                  <button
                    key={s}
                    onClick={() => setSel((x) => ({ ...x, [r.n]: s }))}
                    style={{
                      padding: "9px 16px",
                      borderRadius: 10,
                      cursor: "pointer",
                      font: `500 13px ${T.ui}`,
                      background: on ? T.accDim : T.nest,
                      color: on ? T.acc : T.ink2,
                      border: `1px solid ${on ? T.accLine : T.hair}`,
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ModalPanel>
  );
}

/* =================== EXPORT =================== */
function RoomsBody() {
  return (
    <React.Fragment>
      <Section title="Tiles" note="10 archetypes — A–F plus G–J (new this round)">
        <Frame tag="A" name="Horizontal fader strip — rows + group dots" size="4×3 · 431×319">
          <RoomsA />
        </Frame>
        <Frame tag="B" name="Vertical fader console — mixing desk" size="4×3 · 431×319">
          <RoomsB />
        </Frame>
        <Frame tag="D" name="Room chips — tap to expand" size="4×3 · 431×319">
          <RoomsD />
        </Frame>
        <Frame tag="E" name="House map — rooms placed spatially" size="4×3 · 431×319">
          <RoomsE />
        </Frame>
        <Frame tag="C" name="Compact list rows + master volume" size="3×4 · 319×431">
          <RoomsC />
        </Frame>
        <Frame tag="F" name="Grouped stack — bonded under coordinator" size="3×4 · 319×431">
          <RoomsF />
        </Frame>
        <Frame
          tag="G"
          name="Rotary dials — knob per room"
          size="4×3 · 431×319"
          badge={{ text: "New", tone: "new" }}
        >
          <RoomsG />
        </Frame>
        <Frame
          tag="H"
          name="Group hero — giant numeral + toggle pills"
          size="4×3 · 431×319"
          badge={{ text: "New", tone: "new" }}
        >
          <RoomsH />
        </Frame>
        <Frame
          tag="I"
          name="Segmented LED meters — data-dense"
          size="4×3 · 431×319"
          badge={{ text: "New", tone: "new" }}
        >
          <RoomsI />
        </Frame>
        <Frame
          tag="J"
          name="Radial topology ring — bonds drawn from group"
          size="4×3 · 431×319"
          badge={{ text: "New", tone: "new" }}
        >
          <RoomsJ />
        </Frame>
      </Section>
      <Section
        title="Modal — mixer & grouping"
        note="960×680 · the user flips between these variants"
      >
        <Frame tag="M1" name="Mixer — vertical faders + mutes" size="960×680">
          <ModalMixer />
        </Frame>
        <Frame tag="M2" name="Group Builder — tap to bond on map" size="960×680">
          <ModalGroup />
        </Frame>
        <Frame tag="M3" name="Per-room Source picker" size="960×680">
          <ModalSource />
        </Frame>
      </Section>
    </React.Fragment>
  );
}
window.RoomsCard = {
  id: "rooms",
  name: "Rooms / Multi-room mixer",
  count: "10 tiles · 3 modals",
  Body: RoomsBody,
  title: "Rooms / Multi-room mixer — tile + modal explorations",
  sub: "Per-room Sonos control with live group topology. Ten tile takes now — the original six (strip, console, chips, house map, list, grouped stack) plus four new directions this round: rotary dials, a giant-numeral group hero, segmented LED meters, and a radial topology ring. Live state: Desk (coordinator) + Bedroom bonded on Line-in and playing; Living Room, Bathroom, Kitchen idle.",
};
if (window.__SOLO__ !== false && document.getElementById("root")) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <Stage title={window.RoomsCard.title} sub={window.RoomsCard.sub}>
      <RoomsBody />
    </Stage>,
  );
}
