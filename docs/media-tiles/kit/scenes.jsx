/* ============================================================
   SCENES , 5 tile archetypes + 2 modals (runner + schedule)
   Scenes: Music Everywhere (active), Movie, Quiet, Off.
   ============================================================ */
var useState = React.useState;

const SCN = [
  {
    n: "Music Everywhere",
    short: "Music",
    icon: I.music,
    active: true,
    rooms: "5 rooms",
    src: "Spotify",
    vol: 50,
    desc: "All speakers grouped",
  },
  {
    n: "Movie",
    short: "Movie",
    icon: I.film,
    active: false,
    rooms: "Living Room",
    src: "TV · Beam",
    vol: 35,
    desc: "TV audio · others off",
  },
  {
    n: "Quiet",
    short: "Quiet",
    icon: I.moon,
    active: false,
    rooms: "5 rooms",
    src: "Keep source",
    vol: 14,
    desc: "Lower everything",
  },
  {
    n: "Off",
    short: "Off",
    icon: I.power,
    active: false,
    rooms: "All",
    src: "Stop",
    vol: 0,
    desc: "Stop all playback",
  },
];

/* ---------------- S1 · 2×2 icon grid (3×2) ---------------- */
function ScenesS1() {
  const [active, setActive] = useState("Music Everywhere");
  return (
    <Tile w={319} h={207}>
      <Header icon={I.scene({ size: 19 })} title="Scenes" mb={13} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 10,
          height: 118,
        }}
      >
        {SCN.map((s) => {
          const on = active === s.n;
          return (
            <div
              key={s.n}
              onClick={() => setActive(s.n)}
              style={{
                cursor: "pointer",
                borderRadius: 13,
                padding: "10px 12px",
                background: on ? T.accDim : T.tile2,
                border: `1px solid ${on ? T.accLine : T.hair}`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              {s.icon({ size: 18, c: on ? T.acc : T.ink2 })}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: on ? T.ink : T.ink2 }}>
                  {s.short}
                </span>
                {on && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      background: T.acc,
                      marginLeft: "auto",
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- S2 · single-row pill bar (4×2) ---------------- */
function ScenesS2() {
  const [active, setActive] = useState("Music Everywhere");
  const cur = SCN.find((s) => s.n === active);
  return (
    <Tile w={431} h={207}>
      <Header icon={I.scene({ size: 19 })} title="Scenes" mb={16} />
      <div style={{ display: "flex", gap: 10 }}>
        {SCN.map((s) => {
          const on = active === s.n;
          return (
            <button
              key={s.n}
              onClick={() => setActive(s.n)}
              style={{
                flex: 1,
                cursor: "pointer",
                borderRadius: 12,
                padding: "14px 8px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 9,
                background: on ? T.accDim : T.tile2,
                border: `1px solid ${on ? T.accLine : T.hair}`,
              }}
            >
              {s.icon({ size: 20, c: on ? T.acc : T.ink2 })}
              <span style={{ fontSize: 12.5, fontWeight: 600, color: on ? T.ink : T.ink2 }}>
                {s.short}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: T.acc }} />
        <span style={{ fontSize: 12.5, color: T.ink2 }}>Active , {cur.n}</span>
        <span style={{ marginLeft: "auto", font: `400 12px ${T.mono}`, color: T.ink3 }}>
          {cur.rooms} · {cur.src}
        </span>
      </div>
    </Tile>
  );
}

/* ---------------- S3 · hero scene card + small (3×3) ---------------- */
function ScenesS3() {
  const hero = SCN[0],
    rest = SCN.slice(1);
  return (
    <Tile w={319} h={319}>
      <Header icon={I.scene({ size: 19 })} title="Scenes" mb={14} />
      <div
        style={{
          borderRadius: 14,
          background: T.accDim,
          border: `1px solid ${T.accLine}`,
          padding: 16,
          marginBottom: 11,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              background: "rgba(0,112,243,0.18)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {hero.icon({ size: 20, c: T.acc })}
          </div>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: T.ink }}>{hero.n}</div>
            <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 2 }}>{hero.desc}</div>
          </div>
          <span
            style={{
              marginLeft: "auto",
              width: 8,
              height: 8,
              borderRadius: 99,
              background: T.acc,
              boxShadow: T.accGlow,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {[
            ["Rooms", hero.rooms],
            ["Source", hero.src],
            ["Vol", hero.vol],
          ].map(([l, v]) => (
            <div key={l}>
              <Label style={{ marginBottom: 4 }}>{l}</Label>
              <div style={{ font: `400 13px ${T.mono}`, color: T.ink }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        {rest.map((s) => (
          <div
            key={s.n}
            style={{
              borderRadius: 12,
              background: T.tile2,
              border: `1px solid ${T.hair}`,
              padding: "12px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              cursor: "pointer",
            }}
          >
            {s.icon({ size: 18, c: T.ink2 })}
            <span style={{ fontSize: 12, fontWeight: 600, color: T.ink2 }}>{s.short}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

/* ---------------- S4 · list + "what it sets" subtitle (3×3) ---------------- */
function ScenesS4() {
  const [active, setActive] = useState("Music Everywhere");
  return (
    <Tile w={319} h={319}>
      <Header icon={I.scene({ size: 19 })} title="Scenes" mb={13} />
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {SCN.map((s) => {
          const on = active === s.n;
          return (
            <div
              key={s.n}
              onClick={() => setActive(s.n)}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 13px",
                borderRadius: 12,
                background: on ? T.accDim : T.tile2,
                border: `1px solid ${on ? T.accLine : T.hair}`,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                  background: on ? "rgba(0,112,243,0.18)" : T.nest,
                }}
              >
                {s.icon({ size: 17, c: on ? T.acc : T.ink2 })}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: on ? T.ink : T.ink2 }}>
                  {s.n}
                </div>
                <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>
                  {s.rooms} · {s.src} · vol {s.vol}
                </div>
              </div>
              {on && (
                <span
                  style={{
                    marginLeft: "auto",
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    background: T.acc,
                    flex: "none",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/* ---------------- S5 · radial / dial selector (3×3) ---------------- */
function ScenesS5() {
  const [idx, setIdx] = useState(0);
  const cur = SCN[idx];
  const cx = 80,
    cy = 80,
    r = 58,
    gap = 0.08;
  const seg = (Math.PI * 2) / 4;
  const arc = (i) => {
    const a0 = -Math.PI / 2 + i * seg + gap,
      a1 = -Math.PI / 2 + (i + 1) * seg - gap;
    const x0 = cx + r * Math.cos(a0),
      y0 = cy + r * Math.sin(a0),
      x1 = cx + r * Math.cos(a1),
      y1 = cy + r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  return (
    <Tile w={319} h={319}>
      <Header icon={I.scene({ size: 19 })} title="Scenes" mb={6} />
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ position: "relative", width: 160, height: 160, flex: "none" }}>
          <svg width="160" height="160">
            {SCN.map((s, i) => (
              <path
                key={i}
                d={arc(i)}
                fill="none"
                strokeWidth="11"
                strokeLinecap="round"
                stroke={i === idx ? T.acc : T.nest}
                style={{ cursor: "pointer" }}
                onClick={() => setIdx(i)}
              />
            ))}
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ textAlign: "center" }}>
              {cur.icon({ size: 22, c: T.acc, style: { margin: "0 auto 7px" } })}
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{cur.short}</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {SCN.map((s, i) => (
            <div
              key={s.n}
              onClick={() => setIdx(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 0",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 99,
                  background: i === idx ? T.acc : T.ink3,
                  flex: "none",
                }}
              />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: i === idx ? 600 : 500,
                  color: i === idx ? T.ink : T.ink3,
                }}
              >
                {s.n}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Tile>
  );
}

/* =================== MODALS (760×560) =================== */

/* M1 · Scene runner with "what it sets" peek */
function ModalRunner() {
  const [active, setActive] = useState("Music Everywhere");
  const cur = SCN.find((s) => s.n === active);
  return (
    <ModalPanel w={760} h={560} title="Scenes" icon={I.scene({ size: 20 })}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
          {SCN.map((s) => {
            const on = active === s.n;
            return (
              <div
                key={s.n}
                onClick={() => setActive(s.n)}
                style={{
                  cursor: "pointer",
                  padding: 18,
                  borderRadius: 16,
                  background: on ? T.accDim : T.tile2,
                  border: `1px solid ${on ? T.accLine : T.hair}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 13,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    background: on ? "rgba(0,112,243,0.18)" : T.nest,
                  }}
                >
                  {s.icon({ size: 22, c: on ? T.acc : T.ink2 })}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: on ? T.ink : T.ink2 }}>
                    {s.n}
                  </div>
                  <div style={{ fontSize: 12, color: T.ink3, marginTop: 3 }}>{s.desc}</div>
                </div>
                {on && (
                  <span
                    style={{
                      marginLeft: "auto",
                      width: 9,
                      height: 9,
                      borderRadius: 99,
                      background: T.acc,
                      boxShadow: T.accGlow,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div
          style={{
            flex: 1,
            background: T.tile2,
            border: `1px solid ${T.hair}`,
            borderRadius: 16,
            padding: "18px 20px",
          }}
        >
          <Label style={{ marginBottom: 14 }}>What “{cur.n}” sets</Label>
          <div style={{ display: "flex", gap: 36 }}>
            {[
              ["Rooms", cur.rooms],
              ["Source", cur.src],
              ["Volume", cur.vol === 0 ? "Stop" : cur.vol],
            ].map(([l, v]) => (
              <div key={l}>
                <Label style={{ marginBottom: 6 }}>{l}</Label>
                <div style={{ font: `400 19px ${T.mono}`, color: T.ink }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <button
          style={{
            marginTop: 18,
            padding: "15px",
            borderRadius: 13,
            background: T.acc,
            border: "none",
            color: "#fff",
            font: `600 15px ${T.ui}`,
            cursor: "pointer",
            boxShadow: T.accGlow,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
          }}
        >
          {I.play({ size: 18, c: "#fff" })} Run {cur.n}
        </button>
      </div>
    </ModalPanel>
  );
}

/* M2 · Schedule */
function ModalSchedule() {
  const [on, setOn] = useState({ "Music Everywhere": true, Movie: false, Quiet: true, Off: true });
  const times = {
    "Music Everywhere": "08:00 · weekdays",
    Movie: "Not scheduled",
    Quiet: "22:30 · daily",
    Off: "00:30 · daily",
  };
  return (
    <ModalPanel w={760} h={560} title="Scene Schedule" icon={I.scene({ size: 20 })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SCN.map((s) => {
          const en = on[s.n];
          return (
            <div
              key={s.n}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "18px 20px",
                borderRadius: 14,
                background: T.tile2,
                border: `1px solid ${T.hair}`,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                  background: T.nest,
                }}
              >
                {s.icon({ size: 20, c: en ? T.acc : T.ink2 })}
              </div>
              <div>
                <div style={{ fontSize: 15.5, fontWeight: 600, color: en ? T.ink : T.ink2 }}>
                  {s.n}
                </div>
                <div
                  style={{
                    font: `400 12.5px ${T.mono}`,
                    color: en ? T.ink2 : T.ink3,
                    marginTop: 3,
                  }}
                >
                  {times[s.n]}
                </div>
              </div>
              <button
                onClick={() => setOn((o) => ({ ...o, [s.n]: !o[s.n] }))}
                style={{
                  marginLeft: "auto",
                  width: 52,
                  height: 30,
                  borderRadius: 99,
                  cursor: "pointer",
                  position: "relative",
                  background: en ? T.acc : T.nest,
                  border: `1px solid ${en ? "transparent" : T.hair}`,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    left: en ? 25 : 3,
                    width: 22,
                    height: 22,
                    borderRadius: 99,
                    background: "#fff",
                    transition: "left .15s",
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </ModalPanel>
  );
}

/* =================== EXPORT =================== */
function ScenesBody() {
  return (
    <React.Fragment>
      <Section title="Tiles" note="5 archetypes , S1 through S5">
        <Frame tag="S1" name="2×2 icon grid" size="3×2 · 319×207">
          <ScenesS1 />
        </Frame>
        <Frame tag="S2" name="Single-row pill bar + active status" size="4×2 · 431×207">
          <ScenesS2 />
        </Frame>
        <Frame tag="S3" name="Hero scene card + small row" size="3×3 · 319×319">
          <ScenesS3 />
        </Frame>
        <Frame tag="S4" name="List + “what it sets” subtitle" size="3×3 · 319×319">
          <ScenesS4 />
        </Frame>
        <Frame tag="S5" name="Radial / dial selector" size="3×3 · 319×319">
          <ScenesS5 />
        </Frame>
      </Section>
      <Section title="Modal , runner & schedule" note="760×560">
        <Frame tag="M1" name="Scene runner + “what it sets” peek" size="760×560">
          <ModalRunner />
        </Frame>
        <Frame tag="M2" name="Schedule , per-scene triggers" size="760×560">
          <ModalSchedule />
        </Frame>
      </Section>
    </React.Fragment>
  );
}
window.ScenesCard = {
  id: "scenes",
  name: "Scenes",
  count: "5 tiles · 2 modals",
  Body: ScenesBody,
  title: "Scenes , tile + modal explorations",
  sub: "One-tap presets that set rooms, source and volume across the house: Music Everywhere, Movie, Quiet, Off. The active scene lights the accent. Five tile takes (icon grid → pill bar → hero card → annotated list → radial dial), plus a scene-runner modal that peeks at exactly what each scene sets and an optional schedule.",
};
if (window.__SOLO__ !== false && document.getElementById("root")) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <Stage title={window.ScenesCard.title} sub={window.ScenesCard.sub}>
      <ScenesBody />
    </Stage>,
  );
}
