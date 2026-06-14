/* ============================================================
   QUICK-PLAY (Favorites & Spotify) , 5 tile archetypes + 2 modals
   Sonos Favorites + Spotify presets; tap to play, pick a target.
   ============================================================ */
var useState = React.useState;

const FAVS = [
  { n: "Morning Coffee", sub: "Spotify · Playlist", art: "warm" },
  { n: "Deep Focus", sub: "Spotify · Playlist", art: "indigo" },
  { n: "KCRW 89.9", sub: "Radio", art: "slate" },
  { n: "Jazz Vinyl", sub: "Sonos Favorite", art: "teal" },
  { n: "Discover Weekly", sub: "Spotify", art: "fern" },
  { n: "Lo-Fi Beats", sub: "Spotify", art: "warm" },
];
const ZONES = ["Everywhere", "Living Room", "Kitchen", "Desk + Bedroom"];

function Cover({ art, size, radius = 12, children, style }) {
  return (
    <ArtBlock
      art={art}
      radius={radius}
      style={{ width: size, height: size, flex: "none", ...style }}
    >
      {children}
    </ArtBlock>
  );
}
function PlayBadge({ s = 26 }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 7,
        bottom: 7,
        width: s,
        height: s,
        borderRadius: 99,
        background: T.acc,
        display: "grid",
        placeItems: "center",
        boxShadow: T.accGlow,
      }}
    >
      {I.play({ size: s * 0.5, c: "#fff" })}
    </div>
  );
}

/* target picker chip row */
function TargetPicker({ compact }) {
  const [z, setZ] = useState("Everywhere");
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {ZONES.map((zz) => {
        const on = z === zz;
        return (
          <button
            key={zz}
            onClick={() => setZ(zz)}
            style={{
              cursor: "pointer",
              padding: compact ? "5px 10px" : "8px 13px",
              borderRadius: 9,
              font: `500 ${compact ? 11 : 12.5}px ${T.ui}`,
              background: on ? T.accDim : T.tile2,
              color: on ? T.acc : T.ink2,
              border: `1px solid ${on ? T.accLine : T.hair}`,
            }}
          >
            {zz}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Q1 · horizontal artwork rail (4×2) ---------------- */
function QuickQ1() {
  return (
    <Tile w={431} h={207}>
      <Header
        icon={I.star({ size: 19 })}
        title="Quick Play"
        right={<span style={{ font: `400 12px ${T.mono}`, color: T.ink3 }}>FAVORITES</span>}
        mb={14}
      />
      <div style={{ display: "flex", gap: 13, overflow: "hidden" }}>
        {FAVS.slice(0, 4).map((f, i) => (
          <div key={f.n} style={{ width: 90, flex: "none", cursor: "pointer" }}>
            <Cover art={f.art} size={90}>
              {i === 0 && <PlayBadge />}
            </Cover>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: T.ink,
                marginTop: 8,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {f.n}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: T.ink3,
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {f.sub}
            </div>
          </div>
        ))}
        <div
          style={{
            width: 90,
            flex: "none",
            height: 90,
            borderRadius: 12,
            border: `1px dashed ${T.hair2}`,
            display: "grid",
            placeItems: "center",
            color: T.ink3,
            cursor: "pointer",
          }}
        >
          {I.chevR({ size: 20, c: T.ink3 })}
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- Q2 · grid of square tiles (3×2) ---------------- */
function QuickQ2() {
  return (
    <Tile w={319} h={207}>
      <Header icon={I.star({ size: 19 })} title="Quick Play" mb={13} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gridTemplateRows: "1fr 1fr",
          gap: 9,
          height: 118,
        }}
      >
        {FAVS.map((f, i) => (
          <div
            key={f.n}
            style={{
              position: "relative",
              borderRadius: 11,
              overflow: "hidden",
              cursor: "pointer",
              background: ARTS[f.art],
              border: `1px solid ${T.hair}`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg,transparent 40%,rgba(0,0,0,0.8))",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 8,
                right: 8,
                bottom: 7,
                fontSize: 10.5,
                fontWeight: 600,
                color: "#fff",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {f.n}
            </div>
            {i === 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: T.acc,
                }}
              />
            )}
          </div>
        ))}
      </div>
    </Tile>
  );
}

/* ---------------- Q3 · list with mini-art + target picker (4×2) ---------------- */
function QuickQ3() {
  return (
    <Tile w={431} h={207}>
      <Header icon={I.star({ size: 19 })} title="Quick Play" mb={12} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {FAVS.slice(0, 2).map((f, i) => (
          <div
            key={f.n}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "7px 9px",
              borderRadius: 11,
              background: i === 0 ? T.accDim : T.tile2,
              border: `1px solid ${i === 0 ? T.accLine : T.hair}`,
              cursor: "pointer",
            }}
          >
            <Cover art={f.art} size={38} radius={9} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: T.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {f.n}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: T.ink3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {f.sub}
              </div>
            </div>
            {i === 0 ? (
              <Pill active dot style={{ flex: "none" }}>
                KITCHEN
              </Pill>
            ) : (
              <TBtn size={34}>{I.play({ size: 15, c: T.ink2 })}</TBtn>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Label style={{ flex: "none" }}>Play in</Label>
        <div style={{ display: "flex", gap: 7, overflow: "hidden" }}>
          {["Everywhere", "Living Room", "Kitchen"].map((z, i) => (
            <span
              key={z}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                whiteSpace: "nowrap",
                font: `500 11px ${T.ui}`,
                background: i === 0 ? T.accDim : T.tile2,
                color: i === 0 ? T.acc : T.ink2,
                border: `1px solid ${i === 0 ? T.accLine : T.hair}`,
              }}
            >
              {z}
            </span>
          ))}
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- Q4 · hero favorite + small row (4×2) ---------------- */
function QuickQ4() {
  const hero = FAVS[0];
  return (
    <Tile w={431} h={207}>
      <Header icon={I.star({ size: 19 })} title="Quick Play" mb={14} />
      <div style={{ display: "flex", gap: 14 }}>
        <Cover art={hero.art} size={108}>
          <PlayBadge s={30} />
        </Cover>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <Label style={{ color: T.acc, marginBottom: 6 }}>Resume</Label>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em" }}>{hero.n}</div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3 }}>{hero.sub}</div>
          <div style={{ marginTop: "auto", display: "flex", gap: 9 }}>
            {FAVS.slice(1, 5).map((f) => (
              <Cover key={f.n} art={f.art} size={42} radius={9} style={{ cursor: "pointer" }} />
            ))}
          </div>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- Q5 · cover-flow (4×2) ---------------- */
function QuickQ5() {
  const order = [FAVS[2], FAVS[0], FAVS[1]];
  return (
    <Tile w={431} h={207}>
      <Header icon={I.star({ size: 19 })} title="Quick Play" mb={6} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
          height: 96,
          marginTop: 6,
        }}
      >
        <Cover
          art={order[0].art}
          size={70}
          style={{ transform: "translateX(28px) scale(0.82)", opacity: 0.5 }}
        />
        <Cover
          art={order[1].art}
          size={96}
          style={{ zIndex: 2, boxShadow: "0 12px 30px -10px rgba(0,0,0,0.8)" }}
        >
          <PlayBadge />
        </Cover>
        <Cover
          art={order[2].art}
          size={70}
          style={{ transform: "translateX(-28px) scale(0.82)", opacity: 0.5 }}
        />
      </div>
      <div style={{ textAlign: "center", marginTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{order[1].n}</div>
        <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
          {order[1].sub} · everywhere
        </div>
      </div>
    </Tile>
  );
}

/* =================== MODALS (880×620) =================== */

/* M1 · Favorites */
function ModalFavorites() {
  return (
    <ModalPanel w={880} h={620} title="Favorites" icon={I.star({ size: 20 })}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <Label>Play in</Label>
          <TargetPicker />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
            {FAVS.concat(FAVS.slice(0, 4)).map((f, i) => (
              <div key={i} style={{ cursor: "pointer" }}>
                <Cover
                  art={f.art}
                  size={"100%"}
                  radius={14}
                  style={{ aspectRatio: "1", width: "100%", height: "auto" }}
                >
                  {i === 0 && <PlayBadge s={34} />}
                  {i === 0 && (
                    <span style={{ position: "absolute", top: 10, left: 10 }}>
                      <Pill active dot>
                        PLAYING
                      </Pill>
                    </span>
                  )}
                </Cover>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 10 }}>{f.n}</div>
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{f.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ModalPanel>
  );
}

/* M2 · Spotify browse */
function Row({ title, items }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <Label>{title}</Label>
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.ink3, cursor: "pointer" }}>
          See all
        </span>
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        {items.map((f, i) => (
          <div key={i} style={{ width: 124, flex: "none", cursor: "pointer" }}>
            <Cover art={f.art} size={124} radius={12} />
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                marginTop: 8,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {f.n}
            </div>
            <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 2 }}>{f.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
function ModalSpotify() {
  return (
    <ModalPanel w={880} h={620} title="Spotify" icon={I.spotify({ size: 22 })}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
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
            <span style={{ fontSize: 14, color: T.ink3 }}>Search Spotify…</span>
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
            {I.speaker({ size: 16, c: T.acc })}
            <span style={{ fontSize: 13, fontWeight: 600, color: T.acc }}>Everywhere</span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", paddingRight: 4 }}>
          <Row title="Recently played" items={[FAVS[0], FAVS[4], FAVS[1], FAVS[5], FAVS[3]]} />
          <Row title="Made for you" items={[FAVS[1], FAVS[4], FAVS[0], FAVS[2], FAVS[5]]} />
        </div>
      </div>
    </ModalPanel>
  );
}

/* =================== EXPORT =================== */
function QuickPlayBody() {
  return (
    <React.Fragment>
      <Section title="Tiles" note="5 archetypes , Q1 through Q5">
        <Frame
          tag="Q1"
          name="Horizontal artwork rail"
          size="4×2 · 431×207"
          badge={{ text: "Chosen ✓", tone: "selected" }}
        >
          <QuickQ1 />
        </Frame>
        <Frame tag="Q3" name="List + mini-art + target picker" size="4×2 · 431×207">
          <QuickQ3 />
        </Frame>
        <Frame tag="Q4" name="Hero favorite + small row" size="4×2 · 431×207">
          <QuickQ4 />
        </Frame>
        <Frame tag="Q5" name="Cover-flow" size="4×2 · 431×207">
          <QuickQ5 />
        </Frame>
        <Frame tag="Q2" name="Grid of square tiles (shrunk to 3×2)" size="3×2 · 319×207">
          <QuickQ2 />
        </Frame>
      </Section>
      <Section title="Modal , favorites & browse" note="880×620">
        <Frame tag="M1" name="Favorites , grid + target picker" size="880×620">
          <ModalFavorites />
        </Frame>
        <Frame tag="M2" name="Spotify browse , rows + target" size="880×620">
          <ModalSpotify />
        </Frame>
      </Section>
    </React.Fragment>
  );
}
window.QuickPlayCard = {
  id: "quick-play",
  name: "Quick-Play (Favorites & Spotify)",
  count: "5 tiles · 2 modals",
  Body: QuickPlayBody,
  title: "Quick-Play , tile + modal explorations",
  sub: "One-tap launch of Sonos Favorites and Spotify presets, each with a target picker (play in Kitchen / everywhere). Five tile takes (artwork rail → annotated list → hero + row → cover-flow → square grid), plus Favorites and Spotify-browse modals.",
};
if (window.__SOLO__ !== false && document.getElementById("root")) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <Stage title={window.QuickPlayCard.title} sub={window.QuickPlayCard.sub}>
      <QuickPlayBody />
    </Stage>,
  );
}
