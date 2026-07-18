import { type CSSProperties, type ReactNode, useState } from "react";
import { Icon, type IconName } from "../Icon";

// ---------------------------------------------------------------------------
// Round 3 concepts — MACHINES & INSTRUMENTS
// Throwaway Storybook prototypes. Local state only, no network.
// Fixed wall panel: 1366 x 1024.
// ---------------------------------------------------------------------------

const MONO = `"Space Mono", ui-monospace, "SFMono-Regular", Menlo, monospace`;
const ROUNDED = `"Space Grotesk Variable", ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;

// ===========================================================================
// A — MachineOrbit · radial orbit instrument
// ===========================================================================

const CX = 683;
const CY = 512;
const NOW_H = 14 + 32 / 60;

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (deg: number, r: number) => ({
  x: CX + Math.cos(rad(deg)) * r,
  y: CY + Math.sin(rad(deg)) * r,
});
/** map a wall-clock hour onto the 12-hour orbit; "now" points straight up */
const hourToDeg = (h: number) => (((h - NOW_H + 24) % 24) / 12) * 360 - 90;

const arcPath = (fromDeg: number, toDeg: number, r: number) => {
  const a = polar(fromDeg, r);
  const b = polar(toDeg, r);
  const sweep = (toDeg - fromDeg + 360) % 360;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
};

type Planet = {
  id: string;
  name: string;
  value: string;
  sub: string;
  pct: number;
  icon: IconName;
  hue: string;
  deg: number; // compass position
};

const PLANETS: Planet[] = [
  {
    id: "climate",
    name: "CLIMATE",
    value: "72°",
    sub: "COOLING · 74° NOW",
    pct: 0.72,
    icon: "thermo",
    hue: "#7dd3fc",
    deg: -90,
  },
  {
    id: "tesla",
    name: "TESLA",
    value: "81%",
    sub: "PARKED · 240 MI",
    pct: 0.81,
    icon: "car",
    hue: "#f0abfc",
    deg: 0,
  },
  {
    id: "music",
    name: "MUSIC",
    value: "PLAYING",
    sub: "KHRUANGBIN",
    pct: 0.62,
    icon: "speaker",
    hue: "#fbbf24",
    deg: 90,
  },
  {
    id: "network",
    name: "NETWORK",
    value: "884",
    sub: "MBPS · 12 DEVICES",
    pct: 0.88,
    icon: "wifi",
    hue: "#6ee7b7",
    deg: 180,
  },
];

type Satellite = {
  id: string;
  label: string;
  time: string;
  hour: number;
  nudge: number;
  icon: IconName;
};

const SATELLITES: Satellite[] = [
  {
    id: "sat-dinner",
    label: "DINNER W/ SAM",
    time: "17:30",
    hour: 17.5,
    nudge: -9,
    icon: "calendar",
  },
  { id: "sat-evening", label: "EVENING 71°", time: "17:30", hour: 17.5, nudge: 9, icon: "thermo" },
  { id: "sat-night", label: "NIGHT 69°", time: "23:00", hour: 23, nudge: 0, icon: "moon" },
];

/** deterministic star field */
const STARS = Array.from({ length: 90 }, (_, n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  const t = Math.sin(n * 311.7) * 12543.853;
  const fx = s - Math.floor(s);
  const fy = t - Math.floor(t);
  return {
    id: `star-${n}`,
    x: Math.round(fx * 1366),
    y: Math.round(fy * 1024),
    r: 0.6 + fx * fy * 1.6,
    o: 0.25 + fy * 0.55,
  };
});

const HOUR_TICKS = Array.from({ length: 12 }, (_, n) => {
  const h = (15 + n) % 24;
  return { id: `tick-${h}`, hour: h, deg: hourToDeg(h), labeled: h % 3 === 0 };
});

export function MachineOrbit() {
  const [focus, setFocus] = useState<string | null>(null);
  const sunsetDeg = hourToDeg(20.25);
  const peakDeg = hourToDeg(17);

  return (
    <div
      className="mo-root"
      style={{
        position: "relative",
        width: 1366,
        height: 1024,
        overflow: "hidden",
        background:
          "radial-gradient(ellipse 900px 700px at 50% 46%, #101529 0%, #070a16 58%, #03040b 100%)",
        fontFamily: ROUNDED,
        color: "#e6e9f5",
      }}
    >
      <style>{orbitCss}</style>

      <svg
        width={1366}
        height={1024}
        viewBox="0 0 1366 1024"
        style={{ position: "absolute", inset: 0 }}
        aria-hidden="true"
      >
        {/* stars */}
        {STARS.map((s) => (
          <circle key={s.id} cx={s.x} cy={s.y} r={s.r} fill="#cdd6ff" opacity={s.o * 0.5} />
        ))}

        {/* orbit rings */}
        <circle cx={CX} cy={CY} r={205} fill="none" stroke="#39415e" strokeWidth={1.2} />
        <circle
          cx={CX}
          cy={CY}
          r={305}
          fill="none"
          stroke="#2c334d"
          strokeWidth={1}
          strokeDasharray="2 7"
        />
        <circle cx={CX} cy={CY} r={412} fill="none" stroke="#232941" strokeWidth={1} />

        {/* inner ring: hour ticks */}
        {HOUR_TICKS.map((t) => {
          const a = polar(t.deg, 205 - (t.labeled ? 12 : 7));
          const b = polar(t.deg, 205);
          const l = polar(t.deg, 205 - 28);
          return (
            <g key={t.id}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={t.labeled ? "#8b96c2" : "#4a5372"}
                strokeWidth={t.labeled ? 2 : 1}
              />
              {t.labeled ? (
                <text
                  x={l.x}
                  y={l.y + 4}
                  textAnchor="middle"
                  fill="#7c86ad"
                  fontSize={13}
                  fontFamily={MONO}
                >
                  {String(t.hour).padStart(2, "0")}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* temperature arc: now -> 84° peak at 17:00 */}
        <path
          d={arcPath(-90, peakDeg, 222)}
          fill="none"
          stroke="url(#mo-heat)"
          strokeWidth={7}
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="mo-heat" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fb7185" />
          </linearGradient>
        </defs>
        {(() => {
          const p = polar(peakDeg, 222);
          return <circle cx={p.x} cy={p.y} r={5.5} fill="#fb7185" className="mo-pulse" />;
        })()}

        {/* sunset marker */}
        {(() => {
          const p = polar(sunsetDeg, 205);
          return (
            <circle cx={p.x} cy={p.y} r={5} fill="#fdba74" stroke="#03040b" strokeWidth={1.5} />
          );
        })()}

        {/* now marker */}
        <line x1={CX} y1={CY - 196} x2={CX} y2={CY - 214} stroke="#e6e9f5" strokeWidth={2.5} />

        {/* analog center dial */}
        <circle cx={CX} cy={CY} r={128} fill="#0b1020" stroke="#3a4265" strokeWidth={1.5} />
        <circle cx={CX} cy={CY} r={128} fill="none" stroke="#7c86ad22" strokeWidth={10} />
        {/* hour hand 14:32 */}
        <line
          x1={CX}
          y1={CY}
          x2={polar(((14.53 % 12) / 12) * 360 - 90, 62).x}
          y2={polar(((14.53 % 12) / 12) * 360 - 90, 62).y}
          stroke="#aeb8e0"
          strokeWidth={5}
          strokeLinecap="round"
        />
        {/* minute hand */}
        <line
          x1={CX}
          y1={CY}
          x2={polar((32 / 60) * 360 - 90, 96).x}
          y2={polar((32 / 60) * 360 - 90, 96).y}
          stroke="#e6e9f5"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={5} fill="#e6e9f5" />
      </svg>

      {/* digital readout under the dial */}
      <div
        style={{
          position: "absolute",
          left: CX - 130,
          top: CY + 40,
          width: 260,
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: 2,
            textShadow: "0 0 18px #7c86ad66",
          }}
        >
          14:32
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 13,
            color: "#8b96c2",
            letterSpacing: 3,
            marginTop: 2,
          }}
        >
          FRI · SUNNY · OUT 81°
        </div>
      </div>

      {/* sunset + peak labels */}
      <OrbitTag deg={sunsetDeg} r={168} text="SUNSET 20:15" hue="#fdba74" />
      <OrbitTag deg={peakDeg} r={255} text="PEAK 84°" hue="#fb7185" />

      {/* middle ring satellites */}
      {SATELLITES.map((s) => {
        const p = polar(hourToDeg(s.hour) + s.nudge, 305);
        return (
          <div
            key={s.id}
            className="mo-sat"
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#10162bdd",
                border: "1px solid #3a4265",
                borderRadius: 999,
                padding: "7px 14px 7px 10px",
                boxShadow: "0 4px 18px #00000088",
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  background: "#232c4d",
                  color: "#aeb8e0",
                }}
              >
                <Icon name={s.icon} s={13} sw={2} />
              </span>
              <span
                style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 1, whiteSpace: "nowrap" }}
              >
                {s.label}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: "#7c86ad" }}>{s.time}</span>
            </div>
          </div>
        );
      })}

      {/* outer ring planets */}
      {PLANETS.map((p) => {
        const pos = polar(p.deg, 412);
        const active = focus === p.id;
        const dash = 2 * Math.PI * 46;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setFocus(active ? null : p.id)}
            className={active ? "mo-planet mo-planet-on" : "mo-planet"}
            style={{
              position: "absolute",
              left: pos.x,
              top: pos.y,
              transform: "translate(-50%, -50%)",
              width: 118,
              height: 118,
              borderRadius: 999,
              border: "none",
              padding: 0,
              cursor: "pointer",
              background: "transparent",
              color: "inherit",
              ["--hue" as string]: p.hue,
            }}
            aria-pressed={active}
          >
            <svg
              width={118}
              height={118}
              viewBox="0 0 118 118"
              style={{ position: "absolute", inset: 0 }}
              aria-hidden="true"
            >
              <circle
                cx={59}
                cy={59}
                r={54}
                fill="#0b1020"
                stroke={active ? p.hue : "#3a4265"}
                strokeWidth={active ? 2 : 1.2}
              />
              <circle cx={59} cy={59} r={46} fill="none" stroke="#232941" strokeWidth={5} />
              <circle
                cx={59}
                cy={59}
                r={46}
                fill="none"
                stroke={p.hue}
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray={`${dash * p.pct} ${dash}`}
                transform="rotate(-90 59 59)"
              />
            </svg>
            <span
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                width: "100%",
              }}
            >
              <span style={{ color: p.hue, display: "inline-flex" }}>
                <Icon name={p.icon} s={17} sw={2} />
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: p.value.length > 4 ? 12 : 19,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                {p.value}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, color: "#7c86ad" }}>
                {p.name}
              </span>
            </span>
          </button>
        );
      })}

      {/* focus readout, bottom-left corner */}
      <div
        style={{
          position: "absolute",
          left: 34,
          bottom: 30,
          fontFamily: MONO,
          fontSize: 13,
          letterSpacing: 1.5,
          color: "#8b96c2",
        }}
      >
        {(() => {
          const sel = PLANETS.find((p) => p.id === focus);
          return sel ? (
            <span style={{ color: sel.hue }}>
              ◉ {sel.name} — {sel.value} · {sel.sub}
            </span>
          ) : (
            <span>◌ TAP A PLANET</span>
          );
        })()}
      </div>
      <div
        style={{
          position: "absolute",
          right: 34,
          bottom: 30,
          fontFamily: MONO,
          fontSize: 13,
          letterSpacing: 1.5,
          color: "#565f82",
        }}
      >
        ORBIT · 12H WINDOW
      </div>
      <div
        style={{
          position: "absolute",
          left: 34,
          top: 30,
          fontFamily: MONO,
          fontSize: 13,
          letterSpacing: 3,
          color: "#565f82",
        }}
      >
        HOUSE ORBITAL
      </div>
      <div
        style={{
          position: "absolute",
          right: 34,
          top: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: MONO,
          fontSize: 13,
          letterSpacing: 1.5,
          color: "#8b96c2",
        }}
      >
        <span style={{ color: "#fbbf24", display: "inline-flex" }}>
          <Icon name="dog" s={15} sw={2} />
        </span>
        DOG CAM LIVE
      </div>
    </div>
  );
}

function OrbitTag({ deg, r, text, hue }: { deg: number; r: number; text: string; hue: string }) {
  const p = polar(deg, r);
  return (
    <div
      style={{
        position: "absolute",
        left: p.x,
        top: p.y,
        transform: "translate(-50%, -50%)",
        fontFamily: MONO,
        fontSize: 10.5,
        letterSpacing: 2,
        color: hue,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        textShadow: "0 0 12px #000",
      }}
    >
      {text}
    </div>
  );
}

const orbitCss = `
.mo-root .mo-pulse { animation: mo-pulse 2.6s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
@keyframes mo-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.mo-root .mo-planet { transition: filter .25s ease; -webkit-tap-highlight-color: transparent; }
.mo-root .mo-planet-on { filter: drop-shadow(0 0 16px var(--hue)); }
.mo-root .mo-sat { animation: mo-drift 7s ease-in-out infinite; }
@keyframes mo-drift { 0%,100% { margin-top: 0 } 50% { margin-top: -4px } }
@media (prefers-reduced-motion: reduce) {
  .mo-root *, .mo-root { animation: none !important; transition: none !important; }
}
`;

// ===========================================================================
// B — MachineSplitFlap · departure board
// ===========================================================================

type FlapCellData = { id: string; ch: string; delay: number };

const cellsOf = (rowId: string, text: string, width: number, baseDelay: number): FlapCellData[] => {
  const padded = text.toUpperCase().padEnd(width, " ").slice(0, width);
  const out: FlapCellData[] = [];
  for (let p = 0; p < padded.length; p += 1) {
    out.push({ id: `${rowId}:${p}`, ch: padded[p] ?? " ", delay: baseDelay + p * 0.02 });
  }
  return out;
};

type BoardRow = { id: string; name: string; detail: string; status: string; hot?: boolean };

const BOARD_ROWS: BoardRow[] = [
  { id: "row-climate", name: "CLIMATE", detail: "COOLING → 72°", status: "ON TIME" },
  { id: "row-tesla", name: "TESLA", detail: "CHARGED 81%", status: "240 MI" },
  { id: "row-dinner", name: "DINNER W/ SAM", detail: "17:30", status: "UPCOMING", hot: true },
  { id: "row-market", name: "FARMERS MARKET", detail: "SATURDAY", status: "SCHEDULED" },
  { id: "row-dogcam", name: "DOG CAM", detail: "LIVE FEED", status: "ON AIR" },
];

function FlapCell({ cell, big, hot }: { cell: FlapCellData; big?: boolean; hot?: boolean }) {
  const w = big ? 108 : 27;
  const h = big ? 150 : 42;
  const fs = big ? 108 : 24;
  const color = hot ? "#ffd27a" : "#f2e9d8";
  return (
    <span
      className="sf-cell"
      style={{ width: w, height: h, fontSize: fs, color, animationDelay: `${cell.delay}s` }}
    >
      <span className="sf-ch">{cell.ch}</span>
      <span className="sf-seam" aria-hidden="true" />
      <span
        className="sf-flap"
        style={{ fontSize: fs, animationDelay: `${cell.delay}s` }}
        aria-hidden="true"
      >
        {cell.ch}
      </span>
    </span>
  );
}

export function MachineSplitFlap() {
  const [soundOn, setSoundOn] = useState(true);
  const soundGen = soundOn ? "a" : "b";
  const clockCells = cellsOf("clock", "14:32", 5, 0);
  const soundName = cellsOf(`snd-n-${soundGen}`, "SOUND", 14, 0.9);
  const soundDetail = cellsOf(`snd-d-${soundGen}`, "KHRUANGBIN", 16, 1.05);
  const soundStatus = cellsOf(`snd-s-${soundGen}`, soundOn ? "PLAYING" : "HELD", 10, 1.25);

  return (
    <div
      className="sf-root"
      style={{
        position: "relative",
        width: 1366,
        height: 1024,
        overflow: "hidden",
        background: "linear-gradient(180deg, #17130c 0%, #0d0b07 30%, #090805 100%)",
        fontFamily: MONO,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 42,
      }}
    >
      <style>{flapCss}</style>

      {/* board frame texture */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "repeating-linear-gradient(0deg, transparent 0 3px, #ffffff03 3px 4px)",
          pointerEvents: "none",
        }}
      />

      {/* masthead */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 26,
          color: "#a08a5f",
          fontSize: 15,
          letterSpacing: 6,
          marginBottom: 20,
        }}
      >
        <span>HOUSE DEPARTURES</span>
        <span style={{ color: "#5e5138" }}>·</span>
        <span style={{ color: "#7a6a48" }}>FRI · SUNNY 81° OUT · 74° IN</span>
      </div>

      {/* giant clock */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {clockCells.map((c) => (
          <FlapCell key={c.id} cell={c} big hot />
        ))}
      </div>
      <div style={{ color: "#6a5c3e", fontSize: 13, letterSpacing: 8, marginBottom: 34 }}>
        LOCAL TIME · FEELS 76°
      </div>

      {/* column headings */}
      <div style={{ display: "flex", gap: 26, marginBottom: 10 }}>
        <span style={boardHead(14)}>SERVICE</span>
        <span style={boardHead(16)}>DETAIL</span>
        <span style={boardHead(10)}>STATUS</span>
      </div>

      {/* rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {BOARD_ROWS.map((row) => {
          const base = 0.15 + BOARD_ROWS.indexOf(row) * 0.12;
          return (
            <div key={row.id} style={{ display: "flex", gap: 26 }}>
              <FlapGroup cells={cellsOf(`${row.id}-n`, row.name, 14, base)} hot={row.hot} />
              <FlapGroup cells={cellsOf(`${row.id}-d`, row.detail, 16, base + 0.1)} hot={row.hot} />
              <FlapGroup cells={cellsOf(`${row.id}-s`, row.status, 10, base + 0.2)} hot={row.hot} />
            </div>
          );
        })}

        {/* tappable sound row */}
        <button
          type="button"
          onClick={() => setSoundOn((v) => !v)}
          className="sf-rowbtn"
          style={{
            display: "flex",
            gap: 26,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
          aria-pressed={!soundOn}
        >
          <FlapGroup cells={soundName} />
          <FlapGroup cells={soundDetail} />
          <FlapGroup cells={soundStatus} hot={soundOn} />
        </button>
      </div>

      {/* footer strip */}
      <div
        style={{
          position: "absolute",
          bottom: 30,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 40,
          color: "#6a5c3e",
          fontSize: 13,
          letterSpacing: 4,
        }}
      >
        <span>NET 884 MBPS</span>
        <span>12 DEVICES</span>
        <span>HUMIDITY 46%</span>
        <span style={{ color: "#a08a5f" }}>TAP SOUND ROW TO HOLD</span>
      </div>
    </div>
  );
}

const boardHead = (chars: number): CSSProperties => ({
  width: chars * 27 + (chars - 1) * 4,
  color: "#5e5138",
  fontSize: 11,
  letterSpacing: 3,
  paddingLeft: 4,
});

function FlapGroup({ cells, hot }: { cells: FlapCellData[]; hot?: boolean }) {
  return (
    <span style={{ display: "flex", gap: 4 }}>
      {cells.map((c) => (
        <FlapCell key={c.id} cell={c} hot={hot} />
      ))}
    </span>
  );
}

const flapCss = `
.sf-root .sf-cell {
  position: relative; display: inline-grid; place-items: center;
  background: linear-gradient(180deg, #2b2519 0%, #1c1810 49.6%, #14110b 50.4%, #201b12 100%);
  border-radius: 5px; box-shadow: inset 0 1px 0 #ffffff14, 0 3px 6px #000000aa;
  font-weight: 700; overflow: hidden; user-select: none;
}
.sf-root .sf-ch { position: relative; z-index: 1; line-height: 1; transform: translateY(-4%); }
.sf-root .sf-seam { position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: #000000cc; z-index: 3; }
.sf-root .sf-flap {
  position: absolute; inset: 0 0 50% 0; overflow: hidden; z-index: 2;
  display: grid; place-items: start center;
  background: linear-gradient(180deg, #3a3222 0%, #241f14 100%);
  border-radius: 5px 5px 0 0;
  transform-origin: bottom; transform: rotateX(92deg); opacity: 0;
  animation: sf-flip .5s cubic-bezier(.3,.7,.3,1) both;
  font-weight: 700; color: inherit;
}
.sf-root .sf-flap { line-height: 1; padding-top: 6%; }
@keyframes sf-flip {
  0% { transform: rotateX(0deg); opacity: 1; }
  70% { transform: rotateX(-88deg); opacity: 1; }
  100% { transform: rotateX(-92deg); opacity: 0; }
}
.sf-root .sf-rowbtn { -webkit-tap-highlight-color: transparent; font-family: inherit; }
.sf-root .sf-rowbtn:active .sf-cell { filter: brightness(1.25); }
@media (prefers-reduced-motion: reduce) {
  .sf-root .sf-flap { animation: none !important; opacity: 0 !important; }
  .sf-root * { animation: none !important; transition: none !important; }
}
`;

// ===========================================================================
// C — MachineTerminal · system monitor CRT
// ===========================================================================

const GRN = "#49f2a5";
const AMB = "#ffc069";
const CYN = "#5fd8ff";
const DIM = "#2c7a55";

const TEMP_SERIES = [71, 71, 72, 74, 75, 77, 79, 81, 80, 78, 76, 74];
const NET_SERIES = [610, 720, 690, 810, 884, 850, 902, 884, 930, 884, 860, 884];

const sparkPoints = (series: number[], w: number, h: number) => {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series
    .map(
      (v, n) =>
        `${((n / (series.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`,
    )
    .join(" ");
};

type Proc = { id: string; name: string; cpu: string; mem: string; status: string };

const PROCS: Proc[] = [
  { id: "p-climate", name: "climate.daemon", cpu: "0.8", mem: "42M", status: "OK" },
  { id: "p-tesla", name: "tesla.link", cpu: "0.2", mem: "18M", status: "OK" },
  { id: "p-dogcam", name: "dogcam.stream", cpu: "3.1", mem: "96M", status: "LIVE" },
  { id: "p-sound", name: "sound.sonosd", cpu: "1.4", mem: "51M", status: "OK" },
  { id: "p-net", name: "net.unifi-poll", cpu: "0.3", mem: "24M", status: "OK" },
  { id: "p-cal", name: "cal.sync", cpu: "0.1", mem: "12M", status: "OK" },
];

function TermPanel({
  title,
  hue,
  children,
  style,
}: {
  title: string;
  hue: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        border: `1px solid ${hue}44`,
        borderRadius: 4,
        padding: "20px 16px 14px",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: -9,
          left: 12,
          background: "#050705",
          padding: "0 8px",
          fontSize: 12,
          letterSpacing: 2,
          color: hue,
        }}
      >
        ┤ {title} ├
      </span>
      {children}
    </div>
  );
}

function BlockBar({
  pct,
  hue,
  label,
  right,
}: {
  pct: number;
  hue: string;
  label: string;
  right: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span style={{ width: 92, color: `${hue}cc` }}>{label}</span>
      <span
        style={{
          position: "relative",
          flex: 1,
          height: 14,
          background: "#ffffff0e",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct * 100}%`,
            background: hue,
            boxShadow: `0 0 10px ${hue}88`,
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "repeating-linear-gradient(90deg, transparent 0 8px, #050705 8px 10px)",
          }}
        />
      </span>
      <span style={{ width: 78, textAlign: "right", color: hue }}>{right}</span>
    </div>
  );
}

export function MachineTerminal() {
  const [lampOn, setLampOn] = useState(true);

  return (
    <div
      className="mt-root"
      style={{
        position: "relative",
        width: 1366,
        height: 1024,
        overflow: "hidden",
        background: "#050705",
        fontFamily: MONO,
        color: GRN,
        padding: "26px 30px",
      }}
    >
      <style>{termCss}</style>

      {/* header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 15, color: DIM, letterSpacing: 1 }}>
            wwwebb-panel · house.monitor v3.2 · tty1
          </div>
          <div style={{ fontSize: 15, marginTop: 6 }}>
            <span style={{ color: CYN }}>calum@wall</span>
            <span style={{ color: DIM }}>:~$ </span>
            watch --house --all
            <span className="mt-cursor" aria-hidden="true">
              ▊
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 82,
              fontWeight: 700,
              lineHeight: 0.95,
              color: GRN,
              textShadow: `0 0 22px ${GRN}66`,
            }}
          >
            14:32
          </div>
          <div style={{ fontSize: 13, color: DIM, letterSpacing: 2 }}>
            FRI · SUNNY · OUT 81° · FEELS 76°
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        {/* left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <TermPanel title="THERMAL" hue={AMB}>
            <svg
              width="100%"
              height={110}
              viewBox="0 0 600 110"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                points={sparkPoints(TEMP_SERIES, 600, 110)}
                fill="none"
                stroke={AMB}
                strokeWidth={2.5}
              />
              <polyline
                points={`${sparkPoints(TEMP_SERIES, 600, 110)} 600,110 0,110`}
                fill={`${AMB}18`}
                stroke="none"
              />
            </svg>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 13,
                color: `${AMB}cc`,
              }}
            >
              <span>in 74°</span>
              <span>feels 76°</span>
              <span>out 81°</span>
              <span style={{ color: AMB, fontWeight: 700 }}>peak 84° @ 17:00</span>
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: DIM }}>
              hvac: <span style={{ color: CYN }}>COOLING</span> → setpoint 72° · ambient 74° ·
              evening 71° @ 17:30 · night 69° @ 23:00
            </div>
          </TermPanel>

          <TermPanel title="NETWORK" hue={CYN}>
            <svg
              width="100%"
              height={90}
              viewBox="0 0 600 90"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                points={sparkPoints(NET_SERIES, 600, 90)}
                fill="none"
                stroke={CYN}
                strokeWidth={2.5}
              />
            </svg>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 13,
              }}
            >
              <span style={{ color: CYN, fontWeight: 700 }}>▼ 884 Mbps</span>
              <span style={{ color: `${CYN}aa` }}>12 devices online</span>
              <span style={{ color: DIM }}>loss 0.0%</span>
            </div>
          </TermPanel>

          <TermPanel title="PROC" hue={GRN} style={{ flex: 1 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 70px 70px 70px",
                rowGap: 7,
                fontSize: 13.5,
              }}
            >
              <span style={{ color: DIM }}>NAME</span>
              <span style={{ color: DIM, textAlign: "right" }}>CPU%</span>
              <span style={{ color: DIM, textAlign: "right" }}>MEM</span>
              <span style={{ color: DIM, textAlign: "right" }}>ST</span>
              {PROCS.map((p) => (
                <ProcRow key={p.id} proc={p} />
              ))}
            </div>
          </TermPanel>
        </div>

        {/* right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <TermPanel title="GAUGES" hue={GRN}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <BlockBar pct={0.81} hue={GRN} label="tesla.bat" right="81% 240mi" />
              <BlockBar pct={0.46} hue={CYN} label="humidity" right="46%" />
              <BlockBar pct={0.62} hue={AMB} label="track.pos" right="2:41/4:20" />
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: `${AMB}cc` }}>
              ♪ khruangbin — “so we won’t forget” <span className="mt-blink">●</span> playing
            </div>
          </TermPanel>

          <TermPanel title="AGENDA" hue={CYN}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
              <div>
                <span style={{ color: CYN }}>17:30</span> dinner w/ sam{" "}
                <span style={{ color: DIM }}>(today)</span>
              </div>
              <div>
                <span style={{ color: CYN }}>sat··</span> farmers market{" "}
                <span style={{ color: DIM }}>(scheduled)</span>
              </div>
              <div>
                <span style={{ color: CYN }}>live·</span> dogcam.stream{" "}
                <span style={{ color: GRN }}>▣ watching the good boy</span>
              </div>
            </div>
          </TermPanel>

          <TermPanel title="ACTUATORS" hue={AMB} style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 15 }}>
              <span style={{ color: lampOn ? AMB : DIM, display: "inline-flex" }}>
                <Icon name={lampOn ? "bulb" : "bulb-off"} s={20} sw={2} />
              </span>
              <span style={{ color: `${AMB}cc` }}>lamp.living_room</span>
              <button
                type="button"
                onClick={() => setLampOn((v) => !v)}
                className="mt-toggle"
                style={{
                  fontFamily: "inherit",
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: 2,
                  background: lampOn ? `${AMB}22` : "transparent",
                  color: lampOn ? AMB : DIM,
                  border: `1px solid ${lampOn ? AMB : DIM}`,
                  borderRadius: 3,
                  padding: "6px 14px",
                  cursor: "pointer",
                }}
                aria-pressed={lampOn}
              >
                [ {lampOn ? "ON " : "OFF"} ]
              </button>
              <span style={{ color: DIM, fontSize: 12 }}>
                {lampOn ? "→ 100% warm white" : "→ standby"}
              </span>
            </div>
            <div style={{ marginTop: 16, fontSize: 13, color: DIM }}>
              uptime 47d 03:12 · load 0.42 0.38 0.35 ·{" "}
              <span style={{ color: GRN }}>ALL SYSTEMS NOMINAL</span>
            </div>
          </TermPanel>
        </div>
      </div>

      {/* crt overlays */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "repeating-linear-gradient(0deg, #00000000 0 2px, #00000033 2px 3px)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 120% 100% at 50% 50%, transparent 62%, #000000b0 100%)",
        }}
      />
    </div>
  );
}

function ProcRow({ proc }: { proc: Proc }) {
  const live = proc.status === "LIVE";
  return (
    <>
      <span style={{ color: "#b7ffd9" }}>{proc.name}</span>
      <span style={{ textAlign: "right", color: `${GRN}bb` }}>{proc.cpu}</span>
      <span style={{ textAlign: "right", color: `${GRN}bb` }}>{proc.mem}</span>
      <span style={{ textAlign: "right", color: live ? AMB : GRN, fontWeight: 700 }}>
        {proc.status}
      </span>
    </>
  );
}

const termCss = `
.mt-root .mt-cursor { display: inline-block; margin-left: 4px; animation: mt-blink 1.1s steps(1) infinite; }
.mt-root .mt-blink { animation: mt-blink 1.4s steps(1) infinite; }
@keyframes mt-blink { 0%, 60% { opacity: 1 } 61%, 100% { opacity: 0 } }
.mt-root .mt-toggle { -webkit-tap-highlight-color: transparent; transition: background .15s ease; }
.mt-root .mt-toggle:active { filter: brightness(1.4); }
@media (prefers-reduced-motion: reduce) {
  .mt-root * { animation: none !important; transition: none !important; }
}
`;
