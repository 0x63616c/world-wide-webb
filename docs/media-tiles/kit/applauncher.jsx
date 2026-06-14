/* ============================================================
   TV APPS (was App Launcher) , tile variants + 27-app modal.
   Calum's pick: L3 hero-app-promoted, shown across states.
   ============================================================ */
var useState = React.useState;

const APPS27 = [
  "YouTube",
  "Netflix",
  "Prime Video",
  "Disney+",
  "Hulu",
  "Max",
  "Apple TV+",
  "Paramount+",
  "Peacock",
  "ESPN",
  "Spotify",
  "Plex",
  "Twitch",
  "HBO",
  "YouTube TV",
  "Crunchyroll",
  "Pluto TV",
  "Tubi",
  "Fubo",
  "Showtime",
  "Discovery+",
  "Apple Music",
  "NBA",
  "MLB",
  "PBS",
  "Vimeo",
  "Steam Link",
];
const OPEN_APP = "YouTube";

/* neutral letter glyph for non-brand apps (greyscale , one accent rule) */
function LetterGlyph({ name, s = 26, dim }) {
  if (name === "Spotify") return I.spotify({ size: s, c: dim ? T.ink2 : "#1DB954" });
  const ini = name.replace(/[^A-Za-z0-9+]/g, "").slice(0, 2);
  return (
    <div style={{ font: `700 ${s * 0.7}px ${T.ui}`, color: T.ink2, letterSpacing: "-0.02em" }}>
      {ini}
    </div>
  );
}

/* one app cell , brand mark (color or mono) or letter glyph */
function AppCell({ name, open, mono, label, size = 64, radius = 14, markS = 26 }) {
  const Mark = BRANDS[name];
  return (
    <div
      style={{
        position: "relative",
        width: label ? "auto" : size,
        height: size,
        borderRadius: radius,
        background: open ? T.accDim : T.tile2,
        border: `1px solid ${open ? T.accLine : T.hair}`,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
      }}
    >
      {Mark ? <Mark s={markS} color={!mono} /> : <LetterGlyph name={name} s={markS} dim={mono} />}
      {open && (
        <span
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            width: 7,
            height: 7,
            borderRadius: 99,
            background: T.acc,
            boxShadow: T.accGlow,
          }}
        />
      )}
    </div>
  );
}

/* cell + label under (for labelled variants) */
function AppCellL({ name, open, mono, size = 58 }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: size,
          borderRadius: 14,
          background: open ? T.accDim : T.tile2,
          border: `1px solid ${open ? T.accLine : T.hair}`,
          display: "grid",
          placeItems: "center",
        }}
      >
        {BRANDS[name] ? (
          React.createElement(BRANDS[name], { s: 26, color: !mono })
        ) : (
          <LetterGlyph name={name} s={24} dim={mono} />
        )}
        {open && (
          <span
            style={{
              position: "absolute",
              top: 7,
              right: 7,
              width: 7,
              height: 7,
              borderRadius: 99,
              background: T.acc,
              boxShadow: T.accGlow,
            }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: open ? T.acc : T.ink2,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {name}
        {open && <span style={{ font: `500 9px ${T.ui}`, color: T.acc }}>· OPEN</span>}
      </div>
    </div>
  );
}

const FIVE = ["YouTube", "Netflix", "Prime Video", "Disney+", "Hulu"];

/* ---------------- L3 hero cell , active app OR empty (nothing open) ---------------- */
function HeroCell({ active }) {
  if (!active) {
    return (
      <div
        style={{
          width: 188,
          flex: "none",
          borderRadius: 14,
          background: T.tile2,
          border: `1px solid ${T.hair}`,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: T.nest,
            display: "grid",
            placeItems: "center",
          }}
        >
          {I.tv({ size: 21, c: T.ink3 })}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.ink2 }}>Apple TV</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: T.ink3 }} />
            <span
              style={{
                font: `500 10.5px ${T.ui}`,
                color: T.ink3,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Nothing open
            </span>
          </div>
        </div>
      </div>
    );
  }
  const Mark = BRANDS[active];
  return (
    <div
      style={{
        width: 188,
        flex: "none",
        borderRadius: 14,
        background: T.accDim,
        border: `1px solid ${T.accLine}`,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "pointer",
      }}
    >
      {Mark ? <Mark s={36} color={true} /> : <LetterGlyph name={active} s={36} />}
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>{active}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: T.acc }} />
          <span
            style={{
              font: `500 10.5px ${T.ui}`,
              color: T.acc,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Open · resume
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- L3 · Hero app promoted (4×2) , active-aware ---------------- */
function LaunchL3({ active = "YouTube" }) {
  const others = FIVE.filter((a) => a !== active).slice(0, 4);
  return (
    <Tile w={431} h={207}>
      <Header
        icon={I.apps({ size: 19 })}
        title="TV Apps"
        mb={14}
        right={
          active ? (
            <Pill active dot>
              {active.toUpperCase()}
            </Pill>
          ) : (
            <Pill dot>IDLE</Pill>
          )
        }
      />
      <div style={{ display: "flex", gap: 12, height: 118 }}>
        <HeroCell active={active} />
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 10,
          }}
        >
          {others.map((a) => (
            <AppCell key={a} name={a} size={"100%"} markS={24} />
          ))}
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- L1 · Uniform grid · full-color · logo-only (4×2) ---------------- */
function LaunchL1() {
  const apps = [...FIVE, "more"];
  return (
    <Tile w={431} h={207}>
      <Header
        icon={I.apps({ size: 19 })}
        title="TV Apps"
        right={
          <Pill active dot>
            YOUTUBE
          </Pill>
        }
        mb={14}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }}>
        {apps.map((a) =>
          a === "more" ? (
            <div
              key="m"
              style={{
                height: 64,
                borderRadius: 14,
                background: T.tile2,
                border: `1px dashed ${T.hair2}`,
                display: "grid",
                placeItems: "center",
                color: T.ink3,
                font: `500 11px ${T.ui}`,
                cursor: "pointer",
              }}
            >
              +22
            </div>
          ) : (
            <AppCell key={a} name={a} open={a === OPEN_APP} />
          ),
        )}
      </div>
    </Tile>
  );
}

/* ---------------- L2 · Uniform grid · monochrome glyphs (4×2) ---------------- */
function LaunchL2() {
  const apps = [...FIVE, "more"];
  return (
    <Tile w={431} h={207}>
      <Header
        icon={I.apps({ size: 19 })}
        title="TV Apps"
        right={
          <Pill active dot>
            YOUTUBE
          </Pill>
        }
        mb={14}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }}>
        {apps.map((a) =>
          a === "more" ? (
            <div
              key="m"
              style={{
                height: 64,
                borderRadius: 14,
                background: T.tile2,
                border: `1px dashed ${T.hair2}`,
                display: "grid",
                placeItems: "center",
                color: T.ink3,
                font: `500 11px ${T.ui}`,
                cursor: "pointer",
              }}
            >
              +22
            </div>
          ) : (
            <AppCell key={a} name={a} open={a === OPEN_APP} mono />
          ),
        )}
      </div>
    </Tile>
  );
}

/* ---------------- L4 · List · logo + label (3×2) ---------------- */
function LaunchL4() {
  return (
    <Tile w={319} h={207}>
      <Header icon={I.apps({ size: 19 })} title="TV Apps" mb={12} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {["YouTube", "Netflix", "Prime Video"].map((a) => {
          const open = a === OPEN_APP;
          return (
            <div
              key={a}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "8px 11px",
                borderRadius: 11,
                background: open ? T.accDim : T.tile2,
                border: `1px solid ${open ? T.accLine : T.hair}`,
                cursor: "pointer",
              }}
            >
              <div style={{ width: 34, height: 24, display: "grid", placeItems: "center" }}>
                {React.createElement(BRANDS[a], { s: 22, color: true })}
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: open ? T.ink : T.ink2 }}>
                {a}
              </span>
              {open ? (
                <Pill active dot style={{ marginLeft: "auto" }}>
                  OPEN
                </Pill>
              ) : (
                I.chevR({ size: 16, c: T.ink3, style: { marginLeft: "auto" } })
              )}
            </div>
          );
        })}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            padding: "8px",
            borderRadius: 11,
            border: `1px dashed ${T.hair2}`,
            color: T.ink3,
            font: `500 12px ${T.ui}`,
            cursor: "pointer",
          }}
        >
          {I.grid({ size: 14, c: T.ink3 })} All 27 apps
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- L5 · Rounded tiles + labels (4×2) ---------------- */
function LaunchL5() {
  return (
    <Tile w={431} h={207}>
      <Header icon={I.apps({ size: 19 })} title="TV Apps" mb={14} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
        {FIVE.map((a) => (
          <AppCellL key={a} name={a} open={a === OPEN_APP} />
        ))}
      </div>
    </Tile>
  );
}

/* ---------------- L6 · Compact 3×2 (3×2) ---------------- */
function LaunchL6() {
  return (
    <Tile w={319} h={207}>
      <Header
        icon={I.apps({ size: 19 })}
        title="TV Apps"
        right={
          <Pill active dot>
            YT
          </Pill>
        }
        mb={14}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gridTemplateRows: "1fr",
          gap: 10,
        }}
      >
        {["YouTube", "Netflix", "Disney+"].map((a) => (
          <AppCell key={a} name={a} open={a === OPEN_APP} size={72} markS={28} />
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          padding: "9px",
          borderRadius: 12,
          background: T.tile2,
          border: `1px solid ${T.hair}`,
          color: T.ink2,
          font: `500 12px ${T.ui}`,
          cursor: "pointer",
        }}
      >
        {I.grid({ size: 14 })} More apps
      </div>
    </Tile>
  );
}

/* =================== MODAL (880×600) , full 27-app grid =================== */
function FullGrid({ mono }) {
  return (
    <ModalPanel w={880} h={600} title="TV Apps" icon={I.apps({ size: 20 })}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 14px",
              background: T.tile2,
              border: `1px solid ${T.hair}`,
              borderRadius: 12,
            }}
          >
            {I.search({ size: 17 })}
            <span style={{ fontSize: 14, color: T.ink3 }}>Search 27 installed apps…</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "11px 14px",
              background: T.accDim,
              border: `1px solid ${T.accLine}`,
              borderRadius: 12,
            }}
          >
            <YouTubeMark s={18} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>YouTube</span>
            <Pill active dot>
              OPEN
            </Pill>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", paddingRight: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 14 }}>
            {APPS27.map((a) => (
              <div
                key={a}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 9,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: 78,
                    borderRadius: 14,
                    background: a === OPEN_APP ? T.accDim : T.tile2,
                    border: `1px solid ${a === OPEN_APP ? T.accLine : T.hair}`,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {BRANDS[a] ? (
                    React.createElement(BRANDS[a], { s: 30, color: !mono })
                  ) : (
                    <LetterGlyph name={a} s={30} dim={mono} />
                  )}
                  {a === OPEN_APP && (
                    <span
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: T.acc,
                        boxShadow: T.accGlow,
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: a === OPEN_APP ? T.acc : T.ink2,
                    fontWeight: 500,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                  }}
                >
                  {a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ModalPanel>
  );
}

/* =================== EXPORT =================== */
function AppLauncherBody() {
  return (
    <React.Fragment>
      <Section
        title="L3 · Hero app , states"
        note="Calum’s pick , promotes the active app; designed across active / switched / idle"
      >
        <Frame
          tag="L3"
          name="Active app , YouTube open"
          size="4×2 · 431×207"
          badge={{ text: "Favorite ★", tone: "fav" }}
        >
          <LaunchL3 active="YouTube" />
        </Frame>
        <Frame tag="L3" name="Switched , Netflix open" size="4×2 · 431×207">
          <LaunchL3 active="Netflix" />
        </Frame>
        <Frame tag="L3" name="Empty , nothing open (idle)" size="4×2 · 431×207">
          <LaunchL3 active={null} />
        </Frame>
      </Section>
      <Section
        title="Other tile concepts"
        note="logo treatment comparison (L1 full-color vs L2 mono) + alternates"
      >
        <Frame tag="L1" name="Uniform grid · full-color marks · logo-only" size="4×2 · 431×207">
          <LaunchL1 />
        </Frame>
        <Frame tag="L2" name="Uniform grid · monochrome / outline glyphs" size="4×2 · 431×207">
          <LaunchL2 />
        </Frame>
        <Frame tag="L5" name="Rounded tiles + labels" size="4×2 · 431×207">
          <LaunchL5 />
        </Frame>
        <Frame tag="L4" name="List rows , logo + label + open state" size="3×2 · 319×207">
          <LaunchL4 />
        </Frame>
        <Frame tag="L6" name="Compact grid + more affordance" size="3×2 · 319×207">
          <LaunchL6 />
        </Frame>
      </Section>
      <Section title="Modal , all 27 apps" note="880×600 · currently-open highlighted">
        <Frame
          tag="M1"
          name="Full grid , full-color marks"
          size="880×600"
          badge={{ text: "Best ✓", tone: "selected" }}
        >
          <FullGrid mono={false} />
        </Frame>
        <Frame tag="M2" name="Full grid , monochrome glyphs" size="880×600">
          <FullGrid mono={true} />
        </Frame>
      </Section>
    </React.Fragment>
  );
}
window.AppLauncherCard = {
  id: "app-launcher",
  name: "TV Apps",
  count: "8 tiles · 2 modals",
  Body: AppLauncherBody,
  title: "TV Apps , tile + modal explorations",
  sub: "Streaming launcher for Apple TV’s 27 installed apps. Calum’s pick is L3 (hero app promoted) , shown here across states: the active app open and resumable, a switched app (Netflix), and the idle “nothing open” empty state. Full-color brand marks (the chosen modal treatment) sit beside monochrome glyphs for reference.",
};
if (window.__SOLO__ !== false && document.getElementById("root")) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <Stage title={window.AppLauncherCard.title} sub={window.AppLauncherCard.sub}>
      <AppLauncherBody />
    </Stage>,
  );
}
