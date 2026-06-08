/* ============================================================
   SHARED KIT — design tokens, icons, primitives, stage layout
   Loaded before each card's artifact file. Exports to window.
   ============================================================ */

const T = {
  bg: "#000000",
  tile: "#0a0a0a",
  tile2: "#111111",
  nest: "#181818",
  hair: "rgba(255,255,255,0.07)",
  hair2: "rgba(255,255,255,0.12)",
  ink: "#ededed",
  ink2: "#a1a1a1",
  ink3: "#6e6e6e",
  acc: "#0070f3",
  acc2: "#0061d5",
  accDim: "rgba(0,112,243,0.14)",
  accLine: "rgba(0,112,243,0.45)",
  accGlow: "0 0 0 1px rgba(0,112,243,0.4), 0 0 26px -6px rgba(0,112,243,0.5)",
  amber: "#f4c063",
  r: 20,
  ui: '"Space Grotesk","SF Pro Display",system-ui,sans-serif',
  mono: '"Space Mono",ui-monospace,monospace',
};

/* ---------- helpers ---------- */
const mmss = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60),
    r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
};

/* ---------- icons (thin stroke, --ink-2 by default) ---------- */
function Ic({ d, size = 19, c = T.ink2, sw = 1.6, fill = "none", children, vb = 24, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${vb} ${vb}`}
      fill={fill}
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "none", ...style }}
    >
      {children || <path d={d} />}
    </svg>
  );
}
const I = {
  play: (p = {}) => (
    <Ic {...p} fill={p.c || T.ink} c="none" sw={0}>
      <path d="M8 5v14l11-7z" />
    </Ic>
  ),
  pause: (p = {}) => (
    <Ic {...p} fill={p.c || T.ink} c="none" sw={0}>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1" />
    </Ic>
  ),
  prev: (p = {}) => (
    <Ic {...p} fill={p.c || T.ink2} c="none" sw={0}>
      <path d="M7 5v14h2.2V5zM19 5l-8 7 8 7z" />
    </Ic>
  ),
  next: (p = {}) => (
    <Ic {...p} fill={p.c || T.ink2} c="none" sw={0}>
      <path d="M17 5v14h-2.2V5zM5 5l8 7-8 7z" />
    </Ic>
  ),
  speaker: (p = {}) => (
    <Ic {...p}>
      <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" />
    </Ic>
  ),
  speakerMute: (p = {}) => (
    <Ic {...p}>
      <path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6" />
    </Ic>
  ),
  tv: (p = {}) => (
    <Ic {...p}>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Ic>
  ),
  cast: (p = {}) => (
    <Ic {...p}>
      <path d="M3 19h.01M3 15a5 5 0 0 1 5 5M3 11a9 9 0 0 1 9 9" />
      <rect x="3" y="5" width="18" height="14" rx="2" opacity=".5" />
    </Ic>
  ),
  list: (p = {}) => (
    <Ic {...p}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </Ic>
  ),
  grid: (p = {}) => (
    <Ic {...p}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </Ic>
  ),
  link: (p = {}) => (
    <Ic {...p}>
      <path d="M9 12a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h-1.5M15 12a3 3 0 0 1-3 3H9a3 3 0 0 1 0-6h1.5" />
    </Ic>
  ),
  lock: (p = {}) => (
    <Ic {...p}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Ic>
  ),
  unlock: (p = {}) => (
    <Ic {...p}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7-1.4" />
    </Ic>
  ),
  close: (p = {}) => (
    <Ic {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Ic>
  ),
  plus: (p = {}) => (
    <Ic {...p}>
      <path d="M12 5v14M5 12h14" />
    </Ic>
  ),
  chevR: (p = {}) => (
    <Ic {...p}>
      <path d="M9 6l6 6-6 6" />
    </Ic>
  ),
  chevD: (p = {}) => (
    <Ic {...p}>
      <path d="M6 9l6 6 6-6" />
    </Ic>
  ),
  back: (p = {}) => (
    <Ic {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Ic>
  ),
  power: (p = {}) => (
    <Ic {...p}>
      <path d="M12 4v8M7.5 7a7 7 0 1 0 9 0" />
    </Ic>
  ),
  home: (p = {}) => (
    <Ic {...p}>
      <path d="M4 11l8-7 8 7M6 10v9h12v-9" />
    </Ic>
  ),
  menu: (p = {}) => (
    <Ic {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Ic>
  ),
  apps: (p = {}) => (
    <Ic {...p}>
      <rect x="4" y="4" width="4.5" height="4.5" rx="1" />
      <rect x="9.8" y="4" width="4.5" height="4.5" rx="1" />
      <rect x="15.5" y="4" width="4.5" height="4.5" rx="1" />
      <rect x="4" y="9.8" width="4.5" height="4.5" rx="1" />
      <rect x="9.8" y="9.8" width="4.5" height="4.5" rx="1" />
    </Ic>
  ),
  shuffle: (p = {}) => (
    <Ic {...p}>
      <path d="M3 6h3l9 12h3M18 4l3 2-3 2M3 18h3l3-4M14 8l1-2h3M18 20l3-2-3-2" />
    </Ic>
  ),
  search: (p = {}) => (
    <Ic {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-3.5-3.5" />
    </Ic>
  ),
  music: (p = {}) => (
    <Ic {...p}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Ic>
  ),
  film: (p = {}) => (
    <Ic {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 15h18M8 4v16M16 4v16" />
    </Ic>
  ),
  moon: (p = {}) => (
    <Ic {...p}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </Ic>
  ),
  bolt: (p = {}) => (
    <Ic {...p}>
      <path d="M13 3 4 14h6l-1 7 9-11h-6z" />
    </Ic>
  ),
  scene: (p = {}) => (
    <Ic {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </Ic>
  ),
  star: (p = {}) => (
    <Ic {...p}>
      <path d="M12 4l2.4 5 5.6.8-4 4 1 5.6L12 16.8 7 19.4l1-5.6-4-4 5.6-.8z" />
    </Ic>
  ),
  spotify: (p = {}) => (
    <Ic {...p} c="none" fill={p.c || T.ink}>
      <circle cx="12" cy="12" r="9" fill={p.c || "#1DB954"} />
      <path
        d="M7 9.5c3.2-.9 6.6-.6 9 1M7.4 12.6c2.6-.7 5.4-.4 7.4 1M7.8 15.5c2-.5 4.2-.3 5.8.8"
        stroke="#000"
        strokeWidth="1.3"
        fill="none"
      />
    </Ic>
  ),
};

/* ---------- brand glyphs (app logos) ---------- */
function YouTubeMark({ s = 26, color = true }) {
  return (
    <svg width={s} height={s * 0.7} viewBox="0 0 28 20" style={{ display: "block" }}>
      <rect
        x="0"
        y="0"
        width="28"
        height="20"
        rx="5"
        fill={color ? "#FF0000" : "transparent"}
        stroke={color ? "none" : T.ink2}
        strokeWidth={color ? 0 : 1.4}
      />
      <path d="M11.2 6 L19 10 L11.2 14 Z" fill={color ? "#fff" : T.ink} />
    </svg>
  );
}
function NetflixMark({ s = 26, color = true }) {
  return (
    <svg width={s * 0.62} height={s} viewBox="0 0 16 26" style={{ display: "block" }}>
      <path d="M2 1h3.4l5.2 13.5V1H14v24h-3.4L5.4 11.5V25H2z" fill={color ? "#E50914" : T.ink} />
    </svg>
  );
}
function PrimeMark({ s = 26, color = true }) {
  return (
    <svg width={s * 1.3} height={s} viewBox="0 0 34 26" style={{ display: "block" }}>
      <text
        x="17"
        y="13"
        textAnchor="middle"
        fontFamily={T.ui}
        fontWeight="700"
        fontSize="9"
        fill={color ? "#00A8E1" : T.ink}
        letterSpacing="-0.3"
      >
        prime
      </text>
      <path
        d="M5 18c4.5 3 14.5 3 22 .5"
        stroke={color ? "#00A8E1" : T.ink2}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M25 16.5l2.5 2.2-2.8 1.6z" fill={color ? "#00A8E1" : T.ink2} />
    </svg>
  );
}
function DisneyMark({ s = 26, color = true }) {
  return (
    <svg width={s * 1.55} height={s} viewBox="0 0 40 26" style={{ display: "block" }}>
      <text
        x="17"
        y="16"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontStyle="italic"
        fontWeight="700"
        fontSize="11"
        fill={color ? "#0A2A6B" : T.ink}
      >
        Disney
      </text>
      <text
        x="35"
        y="11"
        textAnchor="middle"
        fontFamily={T.ui}
        fontWeight="700"
        fontSize="9"
        fill={color ? "#0A2A6B" : T.ink}
      >
        +
      </text>
    </svg>
  );
}
function HuluMark({ s = 26, color = true }) {
  return (
    <svg width={s * 1.45} height={s} viewBox="0 0 38 26" style={{ display: "block" }}>
      <text
        x="19"
        y="17"
        textAnchor="middle"
        fontFamily={T.ui}
        fontWeight="800"
        fontSize="12"
        fill={color ? "#1CE783" : T.ink}
        letterSpacing="-0.5"
      >
        hulu
      </text>
    </svg>
  );
}
const BRANDS = {
  YouTube: YouTubeMark,
  Netflix: NetflixMark,
  "Prime Video": PrimeMark,
  "Disney+": DisneyMark,
  Hulu: HuluMark,
};

/* ---------- primitives ---------- */
function Tile({ w, h, children, style, pad = 18, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: w,
        height: h,
        background: T.tile,
        border: `1px solid ${T.hair}`,
        borderRadius: T.r,
        padding: pad,
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
        fontFamily: T.ui,
        color: T.ink,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children, style }) {
  return (
    <div
      style={{
        font: `500 10.5px/1.1 ${T.ui}`,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: T.ink3,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Pill({ children, active, dot, style }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        background: active ? T.accDim : T.tile2,
        color: active ? T.acc : T.ink2,
        border: `1px solid ${active ? T.accLine : T.hair}`,
        fontFamily: T.ui,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{ width: 6, height: 6, borderRadius: 99, background: active ? T.acc : T.ink3 }}
        />
      )}
      {children}
    </div>
  );
}

function Header({ icon, title, right, sub, size = 17.5, mb = 16 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: mb }}>
      {icon}
      <div
        style={{
          fontSize: size,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          color: T.ink,
          whiteSpace: "nowrap",
          flex: "none",
        }}
      >
        {title}
      </div>
      {sub && <div style={{ fontSize: 13, color: T.ink3, fontWeight: 500 }}>{sub}</div>}
      {right && (
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "none",
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}

/* slider: track + fill + white knob */
function Slider({ pct = 50, h = 4, knob = 16, accent = true, style }) {
  return (
    <div
      style={{
        position: "relative",
        height: knob,
        display: "flex",
        alignItems: "center",
        ...style,
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
          background: accent ? T.acc : T.ink2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `calc(${pct}% - ${knob / 2}px)`,
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

/* scrub bar with mm:ss times underneath */
function Scrub({ pos = 310, dur = 1643, accent = true, knob = 14, showTimes = true }) {
  const pct = Math.min(100, (pos / dur) * 100);
  return (
    <div>
      <Slider pct={pct} knob={knob} accent={accent} />
      {showTimes && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 7,
            font: `400 12px ${T.mono}`,
            color: T.ink3,
          }}
        >
          <span style={{ color: T.ink2 }}>{mmss(pos)}</span>
          <span>{mmss(dur)}</span>
        </div>
      )}
    </div>
  );
}

/* round transport button */
function TBtn({ children, size = 44, primary, ghost, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        flex: "none",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        padding: 0,
        background: primary ? T.acc : ghost ? "transparent" : T.tile2,
        border: `1px solid ${primary ? "transparent" : T.hair}`,
        boxShadow: primary ? T.accGlow : "none",
      }}
    >
      {children}
    </button>
  );
}

/* transport cluster (prev / play-pause / next) */
function Transport({ playing = false, big = 56, small = 44, gap = 14, onToggle }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      <TBtn size={small}>{I.prev({ size: small * 0.42 })}</TBtn>
      <TBtn size={big} primary onClick={onToggle}>
        {playing
          ? I.pause({ size: big * 0.4, c: "#fff" })
          : I.play({ size: big * 0.42, c: "#fff" })}
      </TBtn>
      <TBtn size={small}>{I.next({ size: small * 0.42 })}</TBtn>
    </div>
  );
}

/* artwork placeholder block (muted, restrained gradients — not rainbow) */
const ARTS = {
  fern: "linear-gradient(150deg,#1d2b33 0%,#24403f 48%,#3a4a32 100%)",
  warm: "linear-gradient(150deg,#2a221c 0%,#3a2a22 100%)",
  indigo: "linear-gradient(150deg,#191b2e 0%,#23203a 100%)",
  slate: "linear-gradient(150deg,#16181b 0%,#202327 100%)",
  teal: "linear-gradient(150deg,#13242a 0%,#1c3a3a 100%)",
};
function ArtBlock({ art = "fern", radius = 14, children, style, source, blur }) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: radius,
        overflow: "hidden",
        background: ARTS[art] || ARTS.fern,
        border: `1px solid ${T.hair}`,
        filter: blur ? `blur(${blur}px)` : "none",
        ...style,
      }}
    >
      {/* subtle vignette so it reads as media */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 90% at 30% 20%, rgba(255,255,255,0.06), transparent 60%)",
        }}
      />
      {children}
    </div>
  );
}

/* ---------- stage layout ---------- */
function Stage({ title, sub, children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        color: T.ink,
        fontFamily: T.ui,
        padding: "56px 56px 96px",
      }}
    >
      <div style={{ maxWidth: 1640, margin: "0 auto" }}>
        <div style={{ marginBottom: 46 }}>
          <div
            style={{
              font: `600 13px ${T.mono}`,
              color: T.acc,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Control Center · Media
          </div>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em" }}>
            {title}
          </h1>
          {sub && (
            <p
              style={{
                margin: "12px 0 0",
                maxWidth: 760,
                color: T.ink2,
                fontSize: 15,
                lineHeight: 1.55,
              }}
            >
              {sub}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <section style={{ marginTop: 54 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          marginBottom: 26,
          paddingBottom: 14,
          borderBottom: `1px solid ${T.hair}`,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: T.ink2,
          }}
        >
          {title}
        </h2>
        {note && <span style={{ fontSize: 13, color: T.ink3 }}>{note}</span>}
      </div>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "48px 40px", alignItems: "flex-start" }}
      >
        {children}
      </div>
    </section>
  );
}

/* a labeled frame above a tile: archetype name + size */
function Frame({ tag, name, size, children, badge }) {
  /* badge: {text, tone:'selected'|'fav'|'new'|'hold'} — teammate feedback marker */
  const tones = {
    selected: { bg: T.accDim, bd: T.accLine, fg: T.acc },
    fav: { bg: "rgba(244,192,99,0.14)", bd: "rgba(244,192,99,0.45)", fg: T.amber },
    new: { bg: "rgba(0,112,243,0.10)", bd: T.hair2, fg: T.ink2 },
    hold: { bg: T.tile2, bd: T.hair2, fg: T.ink3 },
  };
  const b = badge && tones[badge.tone || "new"];
  const ring = badge && (badge.tone === "selected" || badge.tone === "fav");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
        {tag && (
          <span style={{ font: `600 11px ${T.mono}`, color: T.acc, letterSpacing: "0.04em" }}>
            {tag}
          </span>
        )}
        <span style={{ fontSize: 13, color: T.ink2, fontWeight: 500 }}>{name}</span>
        {badge && (
          <span
            style={{
              font: `600 9.5px ${T.ui}`,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: b.fg,
              background: b.bg,
              border: `1px solid ${b.bd}`,
              borderRadius: 6,
              padding: "2px 7px",
              alignSelf: "center",
            }}
          >
            {badge.text}
          </span>
        )}
        <span
          style={{
            font: `400 11.5px ${T.mono}`,
            color: T.ink3,
            marginLeft: "auto",
            paddingLeft: 14,
          }}
        >
          {size}
        </span>
      </div>
      {ring ? (
        <div
          style={{
            borderRadius: T.r + 5,
            padding: 5,
            border: `1px solid ${b.bd}`,
            background: badge.tone === "fav" ? "rgba(244,192,99,0.05)" : "rgba(0,112,243,0.05)",
            width: "fit-content",
          }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/* modal panel shell on a dim scrim (rendered inline, not overlaid) */
function ModalPanel({
  w = 880,
  h = 640,
  title,
  icon,
  tabs,
  activeTab,
  onTab,
  headerRight,
  children,
}) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: T.r,
        padding: 26,
        background: "rgba(0,0,0,0.55)",
        border: `1px solid ${T.hair}`,
      }}
    >
      {/* scrim hint */}
      <div
        style={{
          position: "absolute",
          top: 13,
          left: 16,
          font: `400 10.5px ${T.mono}`,
          color: T.ink3,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        scrim
      </div>
      <div
        style={{
          width: w,
          height: h,
          background: T.tile,
          border: `1px solid ${T.hair}`,
          borderRadius: T.r,
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.7)",
          margin: "18px auto 0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px 24px 18px" }}>
          {icon}
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</div>
          {tabs && (
            <div
              style={{
                marginLeft: 20,
                display: "flex",
                gap: 6,
                background: T.tile2,
                padding: 4,
                borderRadius: 999,
                border: `1px solid ${T.hair}`,
              }}
            >
              {tabs.map((t, i) => (
                <button
                  key={t}
                  onClick={() => onTab && onTab(i)}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    padding: "7px 14px",
                    borderRadius: 999,
                    font: `500 12.5px ${T.ui}`,
                    letterSpacing: "0.01em",
                    background: i === activeTab ? T.acc : "transparent",
                    color: i === activeTab ? "#fff" : T.ink2,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {headerRight}
            <TBtn size={34}>{I.close({ size: 15 })}</TBtn>
          </div>
        </div>
        <div style={{ flex: 1, padding: "4px 24px 24px", overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}

Object.assign(window, {
  T,
  mmss,
  Ic,
  I,
  BRANDS,
  YouTubeMark,
  NetflixMark,
  PrimeMark,
  DisneyMark,
  HuluMark,
  Tile,
  Label,
  Pill,
  Header,
  Slider,
  Scrub,
  TBtn,
  Transport,
  ArtBlock,
  ARTS,
  Stage,
  Section,
  Frame,
  ModalPanel,
});
