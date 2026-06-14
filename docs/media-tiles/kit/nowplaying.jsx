/* ============================================================
   NOW PLAYING , 8 tile archetypes (A–H) + 3 modal variants
   Sample state: Apple TV → YouTube, "We Investigated a New
   Designer Drug" by fern, 5:10 / 27:23, PAUSED.
   ============================================================ */
var useState = React.useState,
  useRef = React.useRef,
  useEffect = React.useEffect;

const NP = {
  source: "YouTube",
  title: "We Investigated a New Designer Drug",
  artist: "fern",
  pos: 310,
  dur: 1643,
  state: "PAUSED",
  art: "fern",
};

/* small source line: brand glyph + app name (+ optional artist) */
function SourceLine({ mono, size = 12.5, glyph = true, artist = true }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      {glyph && <YouTubeMark s={20} />}
      <span
        style={{
          font: `600 ${size}px ${T.ui}`,
          color: T.ink2,
          letterSpacing: mono ? "0.06em" : "0",
        }}
      >
        {NP.source}
      </span>
      {artist && (
        <>
          <span style={{ color: T.ink3 }}>·</span>
          <span style={{ fontSize: size, color: T.ink3 }}>{NP.artist}</span>
        </>
      )}
    </div>
  );
}

/* ---------------- A · Horizontal split (4×3) ---------------- */
function NowA() {
  const [playing, setPlaying] = useState(false);
  return (
    <Tile w={431} h={319}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Header
          icon={I.tv({ size: 19 })}
          title="TV Now Playing"
          right={<Pill dot>{NP.state}</Pill>}
          mb={0}
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", gap: 16 }}>
            <ArtBlock art={NP.art} style={{ width: 148, height: 148, flex: "none" }}>
              <div style={{ position: "absolute", left: 9, bottom: 9 }}>
                <YouTubeMark s={22} />
              </div>
            </ArtBlock>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                height: 148,
              }}
            >
              <SourceLine />
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  lineHeight: 1.22,
                  letterSpacing: "-0.015em",
                  marginTop: 10,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
                data-comment-anchor="417a3c9cb4-div-41-11"
              >
                {NP.title}
              </div>
              <div style={{ marginTop: 18 }}>
                <Transport
                  playing={playing}
                  big={48}
                  small={40}
                  gap={10}
                  onToggle={() => setPlaying((p) => !p)}
                />
              </div>
            </div>
          </div>
          <Scrub pos={NP.pos} dur={NP.dur} />
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- B · Full-bleed art + scrim (5×3) ---------------- */
function NowB() {
  const [playing, setPlaying] = useState(false);
  const pct = (NP.pos / NP.dur) * 100;
  return (
    <Tile w={544} h={319} pad={0}>
      <ArtBlock art={NP.art} radius={T.r} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: T.r,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.4) 62%, rgba(0,0,0,0.88) 100%)",
        }}
      />
      {/* top row */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          right: 18,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 11px 6px 8px",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
            borderRadius: 999,
            border: `1px solid ${T.hair}`,
          }}
        >
          <YouTubeMark s={20} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>YouTube</span>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Pill dot style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
            {NP.state}
          </Pill>
        </div>
      </div>
      {/* bottom controls */}
      <div style={{ position: "absolute", left: 22, right: 22, bottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {NP.title}
            </div>
            <div style={{ fontSize: 13.5, color: T.ink2, marginTop: 5 }}>{NP.artist}</div>
          </div>
          <Transport
            playing={playing}
            big={52}
            small={42}
            gap={12}
            onToggle={() => setPlaying((p) => !p)}
          />
        </div>
        <div
          style={{
            marginTop: 16,
            position: "relative",
            height: 4,
            borderRadius: 99,
            background: "rgba(255,255,255,0.18)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              width: `${pct}%`,
              height: 4,
              borderRadius: 99,
              background: T.acc,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `calc(${pct}% - 7px)`,
              top: -5,
              width: 14,
              height: 14,
              borderRadius: 99,
              background: "#fff",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            font: `400 12px ${T.mono}`,
            color: T.ink2,
          }}
        >
          <span>{mmss(NP.pos)}</span>
          <span>{mmss(NP.dur)}</span>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- C · Typographic, no art (4×3) ---------------- */
function NowC() {
  const [playing, setPlaying] = useState(false);
  const pct = (NP.pos / NP.dur) * 100;
  const txtBtn = (node, primary) => (
    <button
      onClick={primary ? () => setPlaying((p) => !p) : undefined}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "8px 10px",
        display: "grid",
        placeItems: "center",
      }}
    >
      {node}
    </button>
  );

  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.tv({ size: 19 })}
        title="TV Now Playing"
        right={<Pill dot>{NP.state}</Pill>}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <YouTubeMark s={18} />
        <Label style={{ color: T.ink2 }}>YouTube , {NP.artist}</Label>
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1.08,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {NP.title}
      </div>
      <div style={{ position: "absolute", left: 18, right: 18, bottom: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: `400 12px ${T.mono}`,
            color: T.ink3,
            marginBottom: 8,
          }}
        >
          <span style={{ color: T.acc }}>{mmss(NP.pos)}</span>
          <span>{mmss(NP.dur)}</span>
        </div>
        <div style={{ position: "relative", height: 1, background: T.hair2, marginBottom: 6 }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              width: `${pct}%`,
              height: 1,
              background: T.acc,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `calc(${pct}% - 3px)`,
              top: -2.5,
              width: 6,
              height: 6,
              borderRadius: 99,
              background: T.acc,
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: -10 }}>
          {txtBtn(I.prev({ size: 18 }))}
          {txtBtn(playing ? I.pause({ size: 22, c: T.ink }) : I.play({ size: 22, c: T.ink }), true)}
          {txtBtn(I.next({ size: 18 }))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {I.speaker({ size: 16 })}
            <span style={{ font: `400 12px ${T.mono}`, color: T.ink2 }}>70</span>
          </div>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- D · Disc / vinyl, circular scrub ring (4×3) ---------------- */
function NowD() {
  const [playing, setPlaying] = useState(false);
  const pct = NP.pos / NP.dur;
  const R = 64,
    C = 2 * Math.PI * R;
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.tv({ size: 19 })}
        title="TV Now Playing"
        right={<Pill dot>{NP.state}</Pill>}
      />
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{ position: "relative", width: 148, height: 148, flex: "none" }}>
          <svg
            width="148"
            height="148"
            style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}
          >
            <circle cx="74" cy="74" r={R} fill="none" stroke={T.nest} strokeWidth="5" />
            <circle
              cx="74"
              cy="74"
              r={R}
              fill="none"
              stroke={T.acc}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct)}
            />
          </svg>
          <div style={{ position: "absolute", inset: 18, borderRadius: "50%", overflow: "hidden" }}>
            <ArtBlock art={NP.art} radius={999} style={{ width: "100%", height: "100%" }}>
              <div
                style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 99,
                    background: "#000",
                    border: `2px solid rgba(255,255,255,0.25)`,
                  }}
                />
              </div>
            </ArtBlock>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SourceLine />
          <div
            style={{
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.22,
              letterSpacing: "-0.015em",
              marginTop: 10,
              marginBottom: 16,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {NP.title}
          </div>
          <Transport
            playing={playing}
            big={46}
            small={38}
            gap={9}
            onToggle={() => setPlaying((p) => !p)}
          />
          <div style={{ font: `400 12px ${T.mono}`, color: T.ink3, marginTop: 14 }}>
            <span style={{ color: T.acc }}>{mmss(NP.pos)}</span> / {mmss(NP.dur)}
          </div>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- E · Ambient (blurred art background) (5×3) ---------------- */
function NowE() {
  const [playing, setPlaying] = useState(false);
  return (
    <Tile w={544} h={319} pad={0}>
      <div
        style={{
          position: "absolute",
          inset: -40,
          background: ARTS[NP.art],
          filter: "blur(34px)",
          opacity: 0.7,
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: "rgba(6,6,7,0.6)" }} />
      <div
        style={{ position: "absolute", inset: 0, borderRadius: T.r, border: `1px solid ${T.hair}` }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: 22,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Header
          icon={I.tv({ size: 19 })}
          title="TV Now Playing"
          right={<Pill dot>{NP.state}</Pill>}
          mb={18}
        />
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <ArtBlock
            art={NP.art}
            style={{
              width: 124,
              height: 124,
              flex: "none",
              boxShadow: "0 14px 40px -12px rgba(0,0,0,0.8)",
            }}
          >
            <div style={{ position: "absolute", left: 8, bottom: 8 }}>
              <YouTubeMark s={20} />
            </div>
          </ArtBlock>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SourceLine glyph={false} artist={false} />
            <div
              style={{
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                margin: "8px 0 4px",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {NP.title}
            </div>
            <div style={{ fontSize: 13.5, color: T.ink2 }}>{NP.artist}</div>
          </div>
        </div>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 18 }}>
          <Transport
            playing={playing}
            big={48}
            small={40}
            gap={11}
            onToggle={() => setPlaying((p) => !p)}
          />
          <div style={{ flex: 1 }}>
            <Scrub pos={NP.pos} dur={NP.dur} />
          </div>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- F · Ticker, single line (4×2) ---------------- */
function NowF() {
  const [playing, setPlaying] = useState(false);
  const pct = (NP.pos / NP.dur) * 100;
  return (
    <Tile w={431} h={207}>
      <div style={{ display: "flex", alignItems: "center", height: "100%", gap: 16 }}>
        <ArtBlock art={NP.art} style={{ width: 96, height: 96, flex: "none" }}>
          <div style={{ position: "absolute", left: 7, bottom: 7 }}>
            <YouTubeMark s={18} />
          </div>
        </ArtBlock>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            height: 96,
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
            <Label style={{ color: T.acc }}>{NP.source}</Label>
            <span style={{ width: 4, height: 4, borderRadius: 99, background: T.ink3 }} />
            <Label>{NP.state}</Label>
          </div>
          <div
            style={{
              fontSize: 15.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginBottom: 4,
            }}
          >
            {NP.title}
          </div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 10 }}>{NP.artist}</div>
          <div style={{ position: "relative", height: 3, borderRadius: 99, background: T.nest }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                width: `${pct}%`,
                height: 3,
                borderRadius: 99,
                background: T.acc,
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <TBtn size={48} primary onClick={() => setPlaying((p) => !p)}>
            {playing ? I.pause({ size: 20, c: "#fff" }) : I.play({ size: 21, c: "#fff" })}
          </TBtn>
          <div style={{ font: `400 11px ${T.mono}`, color: T.ink3 }}>{mmss(NP.pos)}</div>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- G · Portrait stack (4×3) ---------------- */
function NowG() {
  const [playing, setPlaying] = useState(false);
  return (
    <Tile w={431} h={319} pad={0}>
      <ArtBlock
        art={NP.art}
        radius={0}
        style={{
          height: 150,
          borderRadius: `${T.r}px ${T.r}px 0 0`,
          borderLeft: "none",
          borderRight: "none",
          borderTop: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px 5px 7px",
            background: "rgba(0,0,0,0.45)",
            borderRadius: 999,
            border: `1px solid ${T.hair}`,
          }}
        >
          <YouTubeMark s={18} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>YouTube</span>
        </div>
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <Pill dot style={{ background: "rgba(0,0,0,0.45)" }}>
            {NP.state}
          </Pill>
        </div>
      </ArtBlock>
      <div style={{ padding: 18 }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            lineHeight: 1.22,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {NP.title}
        </div>
        <div style={{ fontSize: 13, color: T.ink2, margin: "5px 0 14px" }}>{NP.artist}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Transport
            playing={playing}
            big={44}
            small={38}
            gap={9}
            onToggle={() => setPlaying((p) => !p)}
          />
          <div style={{ flex: 1, font: `400 12px ${T.mono}`, color: T.ink3, textAlign: "right" }}>
            <span style={{ color: T.acc }}>{mmss(NP.pos)}</span> / {mmss(NP.dur)}
          </div>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- H · Waveform motif (4×3) ---------------- */
const WAVE = [
  3, 5, 8, 6, 9, 12, 7, 5, 4, 7, 11, 14, 9, 6, 4, 3, 5, 9, 13, 16, 11, 7, 5, 8, 12, 15, 18, 13, 9,
  6, 4, 7, 10, 8, 5, 3, 6, 9, 7, 4, 3, 5, 8, 6, 4, 3, 5, 7, 5, 3,
];
function NowH() {
  const [playing, setPlaying] = useState(false);
  const playedTo = Math.round(WAVE.length * (NP.pos / NP.dur));
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.tv({ size: 19 })}
        title="TV Now Playing"
        right={<Pill dot>{NP.state}</Pill>}
      />
      <SourceLine />
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          lineHeight: 1.22,
          margin: "12px 0 18px",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {NP.title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2.5, height: 64, marginBottom: 8 }}>
        {WAVE.map((v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${(v / 18) * 100}%`,
              borderRadius: 2,
              background: i <= playedTo ? T.acc : T.nest,
              alignSelf: "center",
              minHeight: 3,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          font: `400 12px ${T.mono}`,
          color: T.ink3,
          marginBottom: 12,
        }}
      >
        <span style={{ color: T.acc }}>{mmss(NP.pos)}</span>
        <span>{mmss(NP.dur)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Transport
          playing={playing}
          big={46}
          small={40}
          gap={12}
          onToggle={() => setPlaying((p) => !p)}
        />
      </div>
    </Tile>
  );
}

/* =================== MODALS =================== */

/* draggable scrubber */
function DragScrub({ dur = NP.dur, init = NP.pos, big }) {
  const [pos, setPos] = useState(init);
  const ref = useRef(null);
  const drag = (x) => {
    const r = ref.current.getBoundingClientRect();
    let p = (x - r.left) / r.width;
    p = Math.max(0, Math.min(1, p));
    setPos(p * dur);
  };
  const down = (e) => {
    e.preventDefault();
    drag(e.clientX);
    const mv = (ev) => drag(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  const pct = (pos / dur) * 100,
    k = big ? 20 : 16,
    h = big ? 6 : 4;
  return (
    <div>
      <div
        ref={ref}
        onPointerDown={down}
        style={{
          position: "relative",
          height: k + 10,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: h,
            borderRadius: 99,
            background: T.nest,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${pct}%`,
            height: h,
            borderRadius: 99,
            background: T.acc,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `calc(${pct}% - ${k / 2}px)`,
            width: k,
            height: k,
            borderRadius: 99,
            background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 9,
          font: `400 14px ${T.mono}`,
        }}
      >
        <span style={{ color: T.acc }}>{mmss(pos)}</span>
        <span style={{ color: T.ink3 }}>{mmss(dur)}</span>
      </div>
    </div>
  );
}

/* M1 · Transport & Scrub */
function ModalTransport() {
  const [playing, setPlaying] = useState(false);
  return (
    <ModalPanel w={880} h={640} title="TV Now Playing" icon={I.tv({ size: 20 })}>
      <div style={{ display: "flex", gap: 34, height: "100%" }}>
        <ArtBlock
          art={NP.art}
          radius={16}
          style={{ width: 340, height: 340, flex: "none", alignSelf: "center" }}
        >
          <div
            style={{
              position: "absolute",
              left: 14,
              bottom: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 12px 7px 9px",
              background: "rgba(0,0,0,0.5)",
              borderRadius: 999,
              border: `1px solid ${T.hair}`,
            }}
          >
            <YouTubeMark s={22} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>YouTube</span>
          </div>
        </ArtBlock>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <Pill dot style={{ alignSelf: "flex-start", marginBottom: 18 }}>
            {NP.state}
          </Pill>
          <div
            style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.12 }}
          >
            {NP.title}
          </div>
          <div style={{ fontSize: 16, color: T.ink2, marginTop: 10 }}>{NP.artist}</div>
          <div style={{ marginTop: 36 }}>
            <DragScrub big />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 30 }}>
            <TBtn size={50}>{I.shuffle({ size: 20 })}</TBtn>
            <TBtn size={56}>{I.prev({ size: 24 })}</TBtn>
            <TBtn size={72} primary onClick={() => setPlaying((p) => !p)}>
              {playing ? I.pause({ size: 30, c: "#fff" }) : I.play({ size: 32, c: "#fff" })}
            </TBtn>
            <TBtn size={56}>{I.next({ size: 24 })}</TBtn>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 11,
                width: 150,
              }}
            >
              {I.speaker({ size: 19 })}
              <div style={{ flex: 1 }}>
                <Slider pct={70} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalPanel>
  );
}

/* M2 · TV Remote (D-pad) */
function RemoteBtn({ children, w = 64, h = 58, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: w,
        height: h,
        borderRadius: 14,
        background: T.tile2,
        border: `1px solid ${T.hair}`,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        color: T.ink2,
      }}
    >
      {children}
    </button>
  );
}
function ModalRemote() {
  return (
    <ModalPanel w={880} h={640} title="Apple TV , Remote" icon={I.tv({ size: 20 })}>
      <div style={{ display: "flex", gap: 34, height: "100%" }}>
        {/* now playing strip + media keys */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              gap: 14,
              padding: 16,
              background: T.tile2,
              borderRadius: 16,
              border: `1px solid ${T.hair}`,
              alignItems: "center",
            }}
          >
            <ArtBlock art={NP.art} style={{ width: 64, height: 64, flex: "none" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                <YouTubeMark s={16} />
                <Label style={{ color: T.ink2, whiteSpace: "nowrap" }}>YouTube · {NP.state}</Label>
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {NP.title}
              </div>
              <div style={{ font: `400 12px ${T.mono}`, color: T.ink3, marginTop: 3 }}>
                {mmss(NP.pos)} / {mmss(NP.dur)}
              </div>
            </div>
          </div>
          <Label style={{ margin: "26px 0 12px" }}>Playback</Label>
          <div style={{ display: "flex", gap: 12 }}>
            <RemoteBtn w={88}>{I.prev({ size: 22 })}</RemoteBtn>
            <RemoteBtn w={120}>{I.play({ size: 24, c: T.ink })}</RemoteBtn>
            <RemoteBtn w={88}>{I.next({ size: 22 })}</RemoteBtn>
          </div>
          <Label style={{ margin: "26px 0 12px" }}>Quick keys</Label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <RemoteBtn w={92}>{I.power({ size: 20, c: T.ink2 })}</RemoteBtn>
            <RemoteBtn w={92}>{I.search({ size: 20 })}</RemoteBtn>
            <RemoteBtn w={92}>{I.apps({ size: 20 })}</RemoteBtn>
            <RemoteBtn w={92}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {I.speakerMute({ size: 18 })}
              </div>
            </RemoteBtn>
          </div>
          <div style={{ marginTop: "auto", fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
            No mute on Apple TV , volume routes through Sonos / HomePod output.
          </div>
        </div>
        {/* D-pad cluster */}
        <div
          style={{
            width: 300,
            flex: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              marginBottom: 24,
            }}
          >
            <RemoteBtn w={88} h={48}>
              {I.back({ size: 20 })}
            </RemoteBtn>
            <RemoteBtn w={88} h={48}>
              {I.menu({ size: 20 })}
            </RemoteBtn>
          </div>
          <div
            style={{
              position: "relative",
              width: 240,
              height: 240,
              borderRadius: "50%",
              background: T.tile2,
              border: `1px solid ${T.hair}`,
            }}
          >
            <DpadArrow pos="top" />
            <DpadArrow pos="bottom" />
            <DpadArrow pos="left" />
            <DpadArrow pos="right" />
            <button
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%,-50%)",
                width: 96,
                height: 96,
                borderRadius: "50%",
                background: T.nest,
                border: `1px solid ${T.hair2}`,
                cursor: "pointer",
                color: T.ink,
                font: `500 13px ${T.ui}`,
                letterSpacing: "0.08em",
              }}
            >
              OK
            </button>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              marginTop: 24,
            }}
          >
            <RemoteBtn w={88} h={48}>
              {I.home({ size: 20 })}
            </RemoteBtn>
            <RemoteBtn w={88} h={48}>
              {I.power({ size: 20 })}
            </RemoteBtn>
          </div>
        </div>
      </div>
    </ModalPanel>
  );
}
function DpadArrow({ pos }) {
  const map = {
    top: {
      top: 14,
      left: "50%",
      transform: "translateX(-50%)",
      icon: I.chevD({ size: 22, style: { transform: "rotate(180deg)" } }),
    },
    bottom: { bottom: 14, left: "50%", transform: "translateX(-50%)", icon: I.chevD({ size: 22 }) },
    left: {
      left: 16,
      top: "50%",
      transform: "translateY(-50%)",
      icon: I.chevR({ size: 22, style: { transform: "rotate(180deg)" } }),
    },
    right: { right: 16, top: "50%", transform: "translateY(-50%)", icon: I.chevR({ size: 22 }) },
  };
  const m = map[pos];
  return (
    <button
      style={{
        position: "absolute",
        top: m.top,
        bottom: m.bottom,
        left: m.left,
        right: m.right,
        transform: m.transform,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 8,
      }}
    >
      {m.icon}
    </button>
  );
}

/* M3 · Output Routing */
const ROOMS = [
  { name: "Living Room", dev: "Beam", vol: 70, on: true },
  { name: "Desk", dev: "Era 300 ×2", vol: 66, on: true },
  { name: "Bedroom", dev: "Era 300", vol: 68, on: true },
  { name: "Bathroom", dev: "Era 100", vol: 68, on: false },
  { name: "Kitchen", dev: "Era 100 SL", vol: 53, on: false },
];

function ModalRouting() {
  const [rooms, setRooms] = useState(ROOMS);
  const active = rooms.filter((r) => r.on).length;
  return (
    <ModalPanel w={880} h={640} title="Output Routing" icon={I.cast({ size: 20 })}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 16px",
            background: T.tile2,
            borderRadius: 14,
            border: `1px solid ${T.hair}`,
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <YouTubeMark s={20} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{NP.title.slice(0, 28)}…</span>
          </div>
          <Pill active dot style={{ marginLeft: "auto" }}>
            {active} ROOMS
          </Pill>
        </div>
        <Label style={{ marginBottom: 8 }}>Group volume</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
          {I.speaker({ size: 20 })}
          <div style={{ flex: 1 }}>
            <Slider pct={64} knob={18} h={5} />
          </div>
          <span style={{ font: `400 15px ${T.mono}`, color: T.ink, width: 34, textAlign: "right" }}>
            64
          </span>
        </div>
        <Label style={{ marginBottom: 10 }}>Speakers</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
          {rooms.map((r, i) => (
            <div
              key={r.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "14px 16px",
                borderRadius: 14,
                background: r.on ? T.accDim : T.tile2,
                border: `1px solid ${r.on ? T.accLine : T.hair}`,
              }}
            >
              <button
                onClick={() =>
                  setRooms((rs) => rs.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))
                }
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  flex: "none",
                  cursor: "pointer",
                  background: r.on ? T.acc : "transparent",
                  border: `1.5px solid ${r.on ? T.acc : T.hair2}`,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {r.on && I.play && (
                  <svg
                    width="13"
                    height="13"
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
              </button>
              <div style={{ width: 150 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: r.on ? T.ink : T.ink2 }}>
                  {r.name}
                </div>
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{r.dev}</div>
              </div>
              <div
                style={{ flex: 1, opacity: r.on ? 1 : 0.4, pointerEvents: r.on ? "auto" : "none" }}
              >
                <Slider pct={r.vol} />
              </div>
              <span
                style={{
                  font: `400 14px ${T.mono}`,
                  color: r.on ? T.ink : T.ink3,
                  width: 30,
                  textAlign: "right",
                }}
              >
                {r.vol}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ModalPanel>
  );
}

/* =================== EXPORT =================== */
function NowPlayingBody() {
  return (
    <React.Fragment>
      <Section title="Tiles" note="8 archetypes , A through H">
        <Frame
          tag="A"
          name="Horizontal split , art left, meta + transport right"
          size="4×3 · 431×319"
          badge={{ text: "Selected ✓", tone: "selected" }}
        >
          <NowA />
        </Frame>
        <Frame
          tag="C"
          name="Typographic , no art, giant title + hairline scrub"
          size="4×3 · 431×319"
        >
          <NowC />
        </Frame>
        <Frame tag="D" name="Disc , circular art + circular scrub ring" size="4×3 · 431×319">
          <NowD />
        </Frame>
        <Frame tag="G" name="Portrait stack , art top, transport bottom" size="4×3 · 431×319">
          <NowG />
        </Frame>
        <Frame tag="H" name="Waveform , EQ motif as the scrubber" size="4×3 · 431×319">
          <NowH />
        </Frame>
        <Frame tag="F" name="Ticker , single line (shown shrunk to 4×2)" size="4×2 · 431×207">
          <NowF />
        </Frame>
        <Frame tag="B" name="Full-bleed art , controls over bottom scrim" size="5×3 · 544×319">
          <NowB />
        </Frame>
        <Frame tag="E" name="Ambient , blurred artwork as background" size="5×3 · 544×319">
          <NowE />
        </Frame>
      </Section>
      <Section title="Modal , full controller" note="880×640 · 2 modals">
        <Frame tag="M1" name="Transport & Scrub , draggable scrubber" size="880×640">
          <ModalTransport />
        </Frame>
        <Frame tag="M2" name="TV Remote , D-pad" size="880×640">
          <ModalRemote />
        </Frame>
      </Section>
    </React.Fragment>
  );
}
window.NowPlayingCard = {
  id: "now-playing",
  name: "TV Now Playing",
  count: "8 tiles · 2 modals",
  Body: NowPlayingBody,
  title: "TV Now Playing , tile + modal explorations",
  sub: "Source-aware media hero for the Apple TV / Sonos feed. Eight structurally distinct tile takes spanning the variation axes (hierarchy anchor, artwork treatment, transport shape, orientation), then three modal controllers. Live state: YouTube → “We Investigated a New Designer Drug” by fern, 5:10 / 27:23, paused. Tap any play button or drag the modal scrubber.",
};
if (window.__SOLO__ !== false && document.getElementById("root")) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <Stage title={window.NowPlayingCard.title} sub={window.NowPlayingCard.sub}>
      <NowPlayingBody />
    </Stage>,
  );
}
