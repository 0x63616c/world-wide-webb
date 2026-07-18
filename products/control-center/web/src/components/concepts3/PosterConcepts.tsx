import { type ReactNode, useState } from "react";

/**
 * Round 3 concepts — GRAPHIC / TYPOGRAPHIC POSTERS.
 * Throwaway Storybook prototypes for the 1366x1024 wall panel.
 * Local placeholder state only; no network, no external assets.
 */

const PANEL_W = 1366;
const PANEL_H = 1024;

const grotesk =
  '"Space Grotesk Variable", "Space Grotesk", ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
const mono = '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

function PosterStyles() {
  return (
    <style>{`
@keyframes pcCloudDrift {
	from { transform: translateX(0); }
	to { transform: translateX(90px); }
}
@keyframes pcSunBreathe {
	0%, 100% { opacity: 0.85; }
	50% { opacity: 1; }
}
@keyframes pcNowPulse {
	0%, 100% { opacity: 0.55; }
	50% { opacity: 1; }
}
@keyframes pcRiverShimmer {
	from { stroke-dashoffset: 0; }
	to { stroke-dashoffset: -46; }
}
@media (prefers-reduced-motion: reduce) {
	.pc-cloud, .pc-sun-glow, .pc-now, .pc-shimmer {
		animation: none !important;
	}
}
		`}</style>
  );
}

/* ------------------------------------------------------------------ */
/* A — Ambient poster: one generative scene, data living in the sky   */
/* ------------------------------------------------------------------ */

const ambientHills: ReadonlyArray<{ id: string; d: string; fill: string }> = [
  {
    id: "far",
    d: "M0,760 C180,700 330,724 520,690 C720,654 860,700 1040,672 C1180,650 1290,676 1366,660 L1366,1024 L0,1024 Z",
    fill: "#2e4a63",
  },
  {
    id: "mid",
    d: "M0,820 C160,780 350,806 540,772 C760,734 930,796 1120,764 C1240,744 1320,768 1366,756 L1366,1024 L0,1024 Z",
    fill: "#1f3549",
  },
  {
    id: "near",
    d: "M0,900 C220,856 420,892 640,864 C880,832 1080,890 1366,852 L1366,1024 L0,1024 Z",
    fill: "#14222f",
  },
];

const ambientClouds: ReadonlyArray<{
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity: number;
  dur: string;
}> = [
  { id: "cirrus-a", cx: 300, cy: 190, rx: 150, ry: 26, opacity: 0.5, dur: "52s" },
  { id: "cirrus-b", cx: 980, cy: 130, rx: 190, ry: 30, opacity: 0.4, dur: "68s" },
  { id: "cirrus-c", cx: 640, cy: 300, rx: 120, ry: 20, opacity: 0.32, dur: "44s" },
];

export function PosterAmbientScene() {
  const [musicPlaying, setMusicPlaying] = useState(true);
  const [porchLamp, setPorchLamp] = useState(false);

  // Day arc across the sky. 14:32 is ~58% through daylight -> sun west of apex.
  const sunX = 840;
  const sunY = 236;

  return (
    <div
      style={{
        position: "relative",
        width: PANEL_W,
        height: PANEL_H,
        overflow: "hidden",
        fontFamily: grotesk,
        color: "#fdf6ea",
        background:
          "linear-gradient(180deg, #2d6bb4 0%, #5d9cd4 30%, #a7cde4 52%, #f2d8a8 68%, #f6c98c 74%, #14222f 74.5%)",
        userSelect: "none",
      }}
    >
      <PosterStyles />

      {/* sun day-arc + disc */}
      <svg
        width={PANEL_W}
        height={PANEL_H}
        viewBox={`0 0 ${PANEL_W} ${PANEL_H}`}
        style={{ position: "absolute", inset: 0 }}
        role="img"
        aria-label="Afternoon sky with sun on its day arc"
      >
        <defs>
          <radialGradient id="pcA-sunGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff3cf" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#ffdf94" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffdf94" stopOpacity="0" />
          </radialGradient>
          <filter id="pcA-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <filter id="pcA-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        {/* dotted day arc, sunrise to sunset */}
        <path
          d="M -60 760 Q 683 -180 1426 760"
          fill="none"
          stroke="#fff6dd"
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeDasharray="1 14"
          strokeLinecap="round"
        />

        {/* drifting clouds */}
        {ambientClouds.map((c) => (
          <ellipse
            key={c.id}
            className="pc-cloud"
            cx={c.cx}
            cy={c.cy}
            rx={c.rx}
            ry={c.ry}
            fill="#ffffff"
            opacity={c.opacity}
            filter="url(#pcA-soft)"
            style={{ animation: `pcCloudDrift ${c.dur} ease-in-out infinite alternate` }}
          />
        ))}

        {/* sun */}
        <circle
          className="pc-sun-glow"
          cx={sunX}
          cy={sunY}
          r={170}
          fill="url(#pcA-sunGlow)"
          style={{ animation: "pcSunBreathe 9s ease-in-out infinite" }}
        />
        <circle cx={sunX} cy={sunY} r={46} fill="#fff1c4" />

        {/* layered hills */}
        {ambientHills.map((h) => (
          <path key={h.id} d={h.d} fill={h.fill} />
        ))}

        {/* tiny house on the near ridge, porch lamp tappable via overlay button */}
        <g transform="translate(1046, 812)">
          <path d="M0,26 L0,54 L52,54 L52,26 L26,4 Z" fill="#0c151f" />
          <rect
            x={20}
            y={34}
            width={12}
            height={12}
            rx={1.5}
            fill={porchLamp ? "#ffd98a" : "#1d2c3b"}
          />
          {porchLamp ? (
            <circle cx={26} cy={40} r={26} fill="#ffd98a" opacity={0.18} filter="url(#pcA-soft)" />
          ) : null}
        </g>

        {/* film grain over everything */}
        <rect
          width={PANEL_W}
          height={PANEL_H}
          filter="url(#pcA-grain)"
          opacity={0.05}
          style={{ mixBlendMode: "overlay" }}
        />
      </svg>

      {/* huge clock floating in the sky */}
      <div
        style={{
          position: "absolute",
          top: 108,
          left: 0,
          width: "100%",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: 236,
            lineHeight: 1,
            fontWeight: 300,
            letterSpacing: "-0.02em",
            color: "#ffffff",
            mixBlendMode: "soft-light",
            textShadow: "0 2px 60px rgba(255,255,255,0.35)",
          }}
        >
          14:32
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: mono,
            fontSize: 15,
            letterSpacing: "0.55em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          Friday afternoon &middot; Sunny
        </div>
      </div>

      {/* temperature sitting on the horizon */}
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 596,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: 150,
            fontWeight: 500,
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
            color: "#fff8ea",
            textShadow: "0 6px 40px rgba(20,34,47,0.45)",
          }}
        >
          81&deg;
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: mono,
            fontSize: 13,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: "rgba(255,248,234,0.8)",
          }}
        >
          Outside &middot; Peak 84&deg; at 17:00
        </div>
      </div>

      {/* poster credits — bottom left: climate */}
      <div
        style={{
          position: "absolute",
          left: 96,
          bottom: 64,
          fontFamily: mono,
          fontSize: 13,
          lineHeight: 2.1,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: "rgba(253,246,234,0.72)",
          pointerEvents: "none",
        }}
      >
        <div style={{ color: "#ffd98a" }}>Inside</div>
        <div>Cooling to 72&deg; &middot; Now 74&deg; feels 76&deg;</div>
        <div>Humidity 46% &middot; 12 devices &middot; 884 Mbps</div>
      </div>

      {/* poster credits — bottom right: music (tappable) */}
      <button
        type="button"
        onClick={() => setMusicPlaying((p) => !p)}
        style={{
          position: "absolute",
          right: 96,
          bottom: 64,
          textAlign: "right",
          fontFamily: mono,
          fontSize: 13,
          lineHeight: 2.1,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: "rgba(253,246,234,0.72)",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <div style={{ color: "#ffd98a" }}>{musicPlaying ? "Now playing ▸" : "Paused ‖"}</div>
        <div>Khruangbin &mdash; So We Won&rsquo;t Forget</div>
        <div>Volume 62% &middot; Tap to {musicPlaying ? "pause" : "resume"}</div>
      </button>

      {/* poster credits — top right: events */}
      <div
        style={{
          position: "absolute",
          right: 96,
          top: 72,
          textAlign: "right",
          fontFamily: mono,
          fontSize: 13,
          lineHeight: 2.1,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: "rgba(253,246,234,0.72)",
          pointerEvents: "none",
        }}
      >
        <div style={{ color: "#ffd98a" }}>Ahead</div>
        <div>Dinner with Sam &middot; 17:30</div>
        <div>Farmers market &middot; Sat</div>
      </div>

      {/* top left: tesla + dog cam credit */}
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 72,
          fontFamily: mono,
          fontSize: 13,
          lineHeight: 2.1,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: "rgba(253,246,234,0.72)",
          pointerEvents: "none",
        }}
      >
        <div style={{ color: "#ffd98a" }}>Around the house</div>
        <div>Tesla 81% &middot; 240 mi &middot; Parked</div>
        <div>Dog cam &middot; Live</div>
      </div>

      {/* porch lamp toggle hit area over the little house */}
      <button
        type="button"
        aria-label={porchLamp ? "Turn porch lamp off" : "Turn porch lamp on"}
        onClick={() => setPorchLamp((v) => !v)}
        style={{
          position: "absolute",
          left: 1022,
          top: 790,
          width: 100,
          height: 100,
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 1046,
          top: 886,
          fontFamily: mono,
          fontSize: 11,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: porchLamp ? "#ffd98a" : "rgba(253,246,234,0.45)",
          pointerEvents: "none",
        }}
      >
        Porch {porchLamp ? "on" : "off"}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* B — Swiss type poster: hierarchy through scale, rules, two accents */
/* ------------------------------------------------------------------ */

const swissInk = "#141414";
const swissPaper = "#f4f1ea";
const swissRed = "#e6392b";
const swissBlue = "#1f47d6";

function SwissRule({ y }: { y: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top: y,
        height: 2,
        background: swissInk,
      }}
    />
  );
}

function SwissLabel({ children, color = swissInk }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.32em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </div>
  );
}

const swissStats: ReadonlyArray<{ label: string; value: string; unit: string; accent?: string }> = [
  { label: "Setpoint", value: "72", unit: "° cooling", accent: swissBlue },
  { label: "Humidity", value: "46", unit: "%" },
  { label: "Tesla", value: "81", unit: "% · 240 mi" },
  { label: "Network", value: "884", unit: "Mbps · 12" },
];

export function PosterSwissType() {
  const [lampOn, setLampOn] = useState(true);
  const [musicPlaying, setMusicPlaying] = useState(true);

  return (
    <div
      style={{
        position: "relative",
        width: PANEL_W,
        height: PANEL_H,
        overflow: "hidden",
        background: swissPaper,
        color: swissInk,
        fontFamily: grotesk,
        userSelect: "none",
      }}
    >
      <PosterStyles />

      {/* masthead */}
      <div style={{ position: "absolute", left: 72, top: 56 }}>
        <SwissLabel>Haus &middot; Kontrollzentrum</SwissLabel>
      </div>
      <div style={{ position: "absolute", right: 72, top: 56, textAlign: "right" }}>
        <SwissLabel>Freitag &middot; Sunny &middot; Nr. 03</SwissLabel>
      </div>
      <SwissRule y={92} />

      {/* hero clock, massive numerals */}
      <div style={{ position: "absolute", left: 64, top: 96 }}>
        <div
          style={{
            fontSize: 300,
            lineHeight: 0.95,
            fontWeight: 700,
            letterSpacing: "-0.05em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          14:32
        </div>
      </div>

      {/* hero temperature block, right-aligned against the clock */}
      <div style={{ position: "absolute", right: 72, top: 122, textAlign: "right" }}>
        <div
          style={{
            fontSize: 176,
            lineHeight: 0.9,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            color: swissRed,
          }}
        >
          81&deg;
        </div>
        <div style={{ marginTop: 10 }}>
          <SwissLabel color={swissRed}>Aussen &middot; Peak 84&deg; / 17:00</SwissLabel>
        </div>
      </div>

      <SwissRule y={420} />

      {/* indoor band */}
      <div style={{ position: "absolute", left: 72, top: 448 }}>
        <SwissLabel>Innen</SwissLabel>
        <div
          style={{
            marginTop: 8,
            fontSize: 128,
            lineHeight: 0.95,
            fontWeight: 700,
            letterSpacing: "-0.04em",
          }}
        >
          74&deg;
        </div>
        <div style={{ marginTop: 10 }}>
          <SwissLabel>Feels 76&deg;</SwissLabel>
        </div>
      </div>

      {/* stat columns, aligned to a 4-col grid */}
      <div
        style={{
          position: "absolute",
          left: 420,
          right: 72,
          top: 448,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          columnGap: 32,
        }}
      >
        {swissStats.map((s) => (
          <div key={s.label} style={{ borderLeft: `2px solid ${swissInk}`, paddingLeft: 20 }}>
            <SwissLabel>{s.label}</SwissLabel>
            <div
              style={{
                marginTop: 12,
                fontSize: 72,
                fontWeight: 700,
                lineHeight: 0.95,
                letterSpacing: "-0.03em",
                color: s.accent ?? swissInk,
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: mono,
                fontSize: 13,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#6b6b64",
              }}
            >
              {s.unit}
            </div>
          </div>
        ))}
      </div>

      <SwissRule y={700} />

      {/* agenda + music + lamp, three columns */}
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 728,
          display: "grid",
          gridTemplateColumns: "1.3fr 1.3fr 1fr",
          columnGap: 48,
        }}
      >
        <div>
          <SwissLabel color={swissBlue}>Agenda</SwissLabel>
          <div style={{ marginTop: 16, fontSize: 34, fontWeight: 700, lineHeight: 1.25 }}>
            <div>
              <span style={{ color: swissBlue }}>17:30</span> Dinner with Sam
            </div>
            <div>
              <span style={{ color: swissBlue }}>Sat</span> Farmers market
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMusicPlaying((p) => !p)}
          style={{
            textAlign: "left",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: swissInk,
            fontFamily: grotesk,
          }}
        >
          <SwissLabel color={swissRed}>{musicPlaying ? "Playing ▸" : "Paused ‖"}</SwissLabel>
          <div style={{ marginTop: 16, fontSize: 34, fontWeight: 700, lineHeight: 1.25 }}>
            So We Won&rsquo;t Forget
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: mono,
              fontSize: 13,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#6b6b64",
            }}
          >
            Khruangbin &middot; Vol 62%
          </div>
          {/* progress as a rule */}
          <div style={{ marginTop: 18, position: "relative", height: 2, background: "#d8d4c8" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: 2,
                width: "62%",
                background: swissRed,
              }}
            />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setLampOn((v) => !v)}
          style={{
            textAlign: "left",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: grotesk,
            color: lampOn ? swissInk : "#9a968a",
          }}
        >
          <SwissLabel color={lampOn ? swissBlue : "#9a968a"}>Wohnzimmer Lampe</SwissLabel>
          <div style={{ marginTop: 16, fontSize: 72, fontWeight: 700, lineHeight: 0.95 }}>
            {lampOn ? "ON" : "OFF"}
          </div>
          <div
            style={{
              marginTop: 12,
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: lampOn ? swissBlue : "transparent",
              border: `2px solid ${lampOn ? swissBlue : "#9a968a"}`,
            }}
          />
        </button>
      </div>

      {/* footer folio */}
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 44,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <SwissLabel color="#6b6b64">Tesla parked &middot; Dog cam live</SwissLabel>
        <SwissLabel color="#6b6b64">1366 &times; 1024</SwissLabel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* C — Timeline river: everything positioned by time, not category    */
/* ------------------------------------------------------------------ */

// Window 12:00 -> 22:00 mapped across the full panel width.
const riverStart = 12;
const riverEnd = 22;
const timeToX = (h: number) => ((h - riverStart) / (riverEnd - riverStart)) * PANEL_W;
const nowH = 14 + 32 / 60;
const nowX = timeToX(nowH); // ~620, just left of center

const hourlyTemps: ReadonlyArray<{ h: number; t: number }> = [
  { h: 12, t: 76 },
  { h: 13, t: 78 },
  { h: 14, t: 80 },
  { h: 15, t: 82 },
  { h: 16, t: 83 },
  { h: 17, t: 84 },
  { h: 18, t: 82 },
  { h: 19, t: 79 },
  { h: 20, t: 77 },
  { h: 21, t: 75 },
  { h: 22, t: 73 },
];

const tempTop = 500;
const tempBottom = 690;
const tempToY = (t: number) => tempBottom - ((t - 70) / (86 - 70)) * (tempBottom - tempTop);

function tempPath(): { line: string; area: string } {
  const pts = hourlyTemps.map((p) => `${timeToX(p.h).toFixed(1)},${tempToY(p.t).toFixed(1)}`);
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${PANEL_W},${tempBottom + 40} L 0,${tempBottom + 40} Z`;
  return { line, area };
}

// Sun altitude band: daylight 6:14 -> 20:32, sine arc over the visible window.
function sunArcPoints(): string {
  const rise = 6.23;
  const set = 20.53;
  const pts: string[] = [];
  for (let h = riverStart; h <= Math.min(set, riverEnd); h += 0.25) {
    const alt = Math.sin((Math.PI * (h - rise)) / (set - rise));
    const y = 430 - alt * 190;
    pts.push(`${timeToX(h).toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}
const sunNowAlt = Math.sin((Math.PI * (nowH - 6.23)) / (20.53 - 6.23));
const sunNowY = 430 - sunNowAlt * 190;

const riverHourTicks: ReadonlyArray<number> = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

const riverEvents: ReadonlyArray<{ label: string; sub: string; h: number; color: string }> = [
  { label: "Dinner with Sam", sub: "17:30", h: 17.5, color: "#ffb86b" },
  { label: "Evening → 71°", sub: "Schedule · 17:30", h: 17.5, color: "#7fd4c1" },
  { label: "Peak 84°", sub: "17:00", h: 17, color: "#ff8f6b" },
];

export function PosterTimelineRiver() {
  const [musicPlaying, setMusicPlaying] = useState(true);
  const { line, area } = tempPath();

  return (
    <div
      style={{
        position: "relative",
        width: PANEL_W,
        height: PANEL_H,
        overflow: "hidden",
        background: "linear-gradient(180deg, #090d1a 0%, #0d1526 55%, #0a1120 100%)",
        color: "#e8ecf6",
        fontFamily: grotesk,
        userSelect: "none",
      }}
    >
      <PosterStyles />

      {/* header: clock + live numbers, outside the river */}
      <div style={{ position: "absolute", left: 72, top: 56 }}>
        <div
          style={{
            fontSize: 128,
            fontWeight: 600,
            lineHeight: 0.95,
            letterSpacing: "-0.03em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          14:32
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: mono,
            fontSize: 13,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: "#8b95ad",
          }}
        >
          Friday &middot; Sunny &middot; The next ten hours
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 72,
          top: 66,
          display: "flex",
          gap: 56,
          textAlign: "right",
        }}
      >
        {[
          { big: "81°", small: "Outside" },
          { big: "74°", small: "Inside · cool 72°" },
          { big: "81%", small: "Tesla · 240 mi" },
        ].map((s) => (
          <div key={s.small}>
            <div style={{ fontSize: 64, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em" }}>
              {s.big}
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: mono,
                fontSize: 12,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "#8b95ad",
              }}
            >
              {s.small}
            </div>
          </div>
        ))}
      </div>

      {/* the river */}
      <svg
        width={PANEL_W}
        height={PANEL_H}
        viewBox={`0 0 ${PANEL_W} ${PANEL_H}`}
        style={{ position: "absolute", inset: 0 }}
        role="img"
        aria-label="Timeline river from noon to ten at night"
      >
        <defs>
          <linearGradient id="pcC-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff8f6b" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ff8f6b" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="pcC-past" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#090d1a" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#090d1a" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="pcC-sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffe9b0" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffe9b0" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* hour grid */}
        {riverHourTicks.map((h) => (
          <g key={`tick-${h}`}>
            <line
              x1={timeToX(h)}
              y1={250}
              x2={timeToX(h)}
              y2={760}
              stroke="#233150"
              strokeWidth={1}
            />
            <text
              x={timeToX(h)}
              y={792}
              fill={h === 14 ? "#e8ecf6" : "#5c6884"}
              fontFamily={mono}
              fontSize={14}
              letterSpacing="0.2em"
              textAnchor="middle"
            >
              {`${h}:00`}
            </text>
          </g>
        ))}

        {/* sun arc band */}
        <polyline
          points={sunArcPoints()}
          fill="none"
          stroke="#f4c667"
          strokeOpacity={0.55}
          strokeWidth={2}
          strokeDasharray="1 10"
          strokeLinecap="round"
        />
        <circle cx={nowX} cy={sunNowY} r={60} fill="url(#pcC-sun)" />
        <circle cx={nowX} cy={sunNowY} r={13} fill="#ffe9b0" />
        {/* sunset moment on the arc */}
        <g transform={`translate(${timeToX(20.53)}, 430)`}>
          <circle r={5} fill="#f4c667" />
          <text
            x={0}
            y={-14}
            fill="#f4c667"
            fontFamily={mono}
            fontSize={12}
            letterSpacing="0.2em"
            textAnchor="middle"
          >
            SUNSET 20:32
          </text>
        </g>

        {/* temperature band */}
        <path d={area} fill="url(#pcC-area)" />
        <path
          className="pc-shimmer"
          d={line}
          fill="none"
          stroke="#ffb86b"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="30 16"
          style={{ animation: "pcRiverShimmer 4s linear infinite" }}
        />
        {/* current temp point on the curve */}
        <circle cx={nowX} cy={tempToY(81)} r={7} fill="#ffb86b" />

        {/* dim the past */}
        <rect x={0} y={230} width={nowX} height={580} fill="url(#pcC-past)" />

        {/* now line */}
        <line
          className="pc-now"
          x1={nowX}
          y1={220}
          x2={nowX}
          y2={800}
          stroke="#e8ecf6"
          strokeWidth={2}
          style={{ animation: "pcNowPulse 4s ease-in-out infinite" }}
        />
        <circle className="pc-now" cx={nowX} cy={220} r={5} fill="#e8ecf6" />
      </svg>

      {/* now caption */}
      <div
        style={{
          position: "absolute",
          left: nowX + 16,
          top: 226,
          fontFamily: mono,
          fontSize: 12,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: "#e8ecf6",
          pointerEvents: "none",
        }}
      >
        Now &middot; 81&deg;
      </div>

      {/* future event flags above the river */}
      {riverEvents.map((e) => (
        <div
          key={`${e.label}-${e.sub}`}
          style={{
            position: "absolute",
            left: timeToX(e.h),
            top: e.label.startsWith("Evening") ? 830 : e.label.startsWith("Peak") ? 452 : 300,
            transform: "translateX(-1px)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 2,
              height: e.label.startsWith("Peak") ? 26 : 40,
              background: e.color,
              opacity: 0.8,
            }}
          />
          <div style={{ paddingLeft: 12, marginTop: 6, whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: e.color }}>{e.label}</div>
            <div
              style={{
                marginTop: 2,
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "#8b95ad",
              }}
            >
              {e.sub}
            </div>
          </div>
        </div>
      ))}

      {/* past marker: music started (tappable, pauses the river of sound) */}
      <button
        type="button"
        onClick={() => setMusicPlaying((p) => !p)}
        style={{
          position: "absolute",
          left: timeToX(13.97) - 8,
          top: 836,
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: grotesk,
          color: "#e8ecf6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "2px solid #b8a5ff",
              color: "#b8a5ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            {musicPlaying ? "▸" : "‖"}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "#b8a5ff" }}>
              So We Won&rsquo;t Forget
            </div>
            <div
              style={{
                marginTop: 2,
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "#8b95ad",
              }}
            >
              Khruangbin &middot; started 13:58 &middot; {musicPlaying ? "playing" : "paused"} 62%
            </div>
          </div>
        </div>
      </button>

      {/* beyond the right edge: Saturday */}
      <div
        style={{
          position: "absolute",
          right: 40,
          top: 300,
          textAlign: "right",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 600, color: "#7fa8ff" }}>Farmers market &rarr;</div>
        <div
          style={{
            marginTop: 2,
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "#8b95ad",
          }}
        >
          Saturday
        </div>
      </div>

      {/* footer strip */}
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 40,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: mono,
          fontSize: 12,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: "#5c6884",
        }}
      >
        <div>Humidity 46% &middot; 884 Mbps &middot; 12 devices</div>
        <div>Dog cam live &middot; Tesla parked</div>
      </div>
    </div>
  );
}
