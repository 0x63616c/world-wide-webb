import { useState } from "react";
import { Icon, type IconName } from "../Icon";

// Round 3 concepts , "borrowed media metaphors". Two throwaway Storybook
// prototypes for the 1366x1024 wall panel: a game-console springboard and a
// modern newspaper front page. Local state only, no network, no real data.

const PANEL_W = 1366;
const PANEL_H = 1024;

/* ------------------------------------------------------------------ */
/* A , MetaphorSpringboard: console channel row                        */
/* ------------------------------------------------------------------ */

const SPRING_CSS = `
.mmc-spring {
  font-family: ui-rounded, "SF Pro Rounded", "Space Grotesk Variable", system-ui, sans-serif;
}
@keyframes mmcTicker {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
@keyframes mmcEq {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}
@keyframes mmcPulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
@keyframes mmcLive {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.mmc-ticker-track {
  display: flex;
  width: max-content;
  animation: mmcTicker 28s linear infinite;
}
.mmc-eq-bar {
  transform-origin: bottom;
  animation: mmcEq 0.9s ease-in-out infinite;
}
.mmc-live-dot { animation: mmcLive 1.6s ease-in-out infinite; }
.mmc-channel {
  transition:
    width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
    height 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
    transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.45s ease;
}
.mmc-channel:active { transform: scale(0.96); }
.mmc-focus-glow { animation: mmcPulse 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .mmc-ticker-track, .mmc-eq-bar, .mmc-live-dot, .mmc-focus-glow { animation: none; }
  .mmc-channel { transition: none; }
}
`;

type ChannelId = "climate" | "music" | "tesla" | "dogcam" | "calendar" | "weather";

interface Channel {
  id: ChannelId;
  label: string;
  icon: IconName;
  gradient: string;
  glow: string;
  scene: (focused: boolean) => React.ReactNode;
}

function EqualizerBars({ big }: { big: boolean }) {
  const bars: Array<{ key: string; h: number; delay: string }> = [
    { key: "eq-a", h: 0.55, delay: "0s" },
    { key: "eq-b", h: 0.95, delay: "0.15s" },
    { key: "eq-c", h: 0.7, delay: "0.3s" },
    { key: "eq-d", h: 1, delay: "0.45s" },
    { key: "eq-e", h: 0.6, delay: "0.1s" },
    { key: "eq-f", h: 0.85, delay: "0.55s" },
  ];
  const maxH = big ? 64 : 40;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: big ? 7 : 5, height: maxH }}>
      {bars.map((b) => (
        <div
          key={b.key}
          className="mmc-eq-bar"
          style={{
            width: big ? 10 : 7,
            height: maxH * b.h,
            borderRadius: 99,
            background: "rgba(255,255,255,0.92)",
            animationDelay: b.delay,
          }}
        />
      ))}
    </div>
  );
}

function CarSilhouette({ w }: { w: number }) {
  return (
    <svg width={w} height={w * 0.42} viewBox="0 0 200 84" aria-hidden="true">
      <title>Car</title>
      <path
        d="M14 58 C14 46 26 40 44 38 L62 22 C68 16 78 12 96 12 L124 12 C140 12 152 20 160 30 L172 38 C184 40 192 46 192 56 L192 62 C192 66 188 68 184 68 L166 68 A16 16 0 0 0 134 68 L74 68 A16 16 0 0 0 42 68 L22 68 C17 68 14 65 14 60 Z"
        fill="rgba(255,255,255,0.92)"
      />
      <path
        d="M70 24 C76 18 84 16 96 16 L118 16 L126 36 L64 36 Z M132 18 C142 20 150 26 156 34 L134 36 Z"
        fill="rgba(150,20,30,0.9)"
      />
      <circle cx="58" cy="68" r="11" fill="rgba(20,8,10,0.9)" />
      <circle cx="150" cy="68" r="11" fill="rgba(20,8,10,0.9)" />
      <circle cx="58" cy="68" r="4.5" fill="rgba(255,255,255,0.7)" />
      <circle cx="150" cy="68" r="4.5" fill="rgba(255,255,255,0.7)" />
    </svg>
  );
}

const CHANNELS: Channel[] = [
  {
    id: "climate",
    label: "Climate",
    icon: "thermo",
    gradient: "linear-gradient(160deg, #0ea5e9 0%, #2563eb 55%, #4338ca 100%)",
    glow: "rgba(56,189,248,0.65)",
    scene: (focused) => (
      <>
        <div
          style={{
            fontSize: focused ? 88 : 52,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.03em",
          }}
        >
          72°
        </div>
        <div style={{ fontSize: focused ? 17 : 13, opacity: 0.85, fontWeight: 600 }}>
          Cooling · now 74° · 46%
        </div>
      </>
    ),
  },
  {
    id: "music",
    label: "Music",
    icon: "speaker",
    gradient: "linear-gradient(160deg, #a21caf 0%, #7c3aed 55%, #4c1d95 100%)",
    glow: "rgba(192,132,252,0.65)",
    scene: (focused) => (
      <>
        <EqualizerBars big={focused} />
        <div style={{ fontSize: focused ? 20 : 13, fontWeight: 800, marginTop: focused ? 14 : 8 }}>
          So We Won't Forget
        </div>
        <div style={{ fontSize: focused ? 15 : 11, opacity: 0.8, fontWeight: 600 }}>
          Khruangbin · 62%
        </div>
      </>
    ),
  },
  {
    id: "tesla",
    label: "Tesla",
    icon: "car",
    gradient: "linear-gradient(160deg, #ef4444 0%, #b91c1c 55%, #7f1d1d 100%)",
    glow: "rgba(248,113,113,0.65)",
    scene: (focused) => (
      <>
        <CarSilhouette w={focused ? 180 : 110} />
        <div style={{ fontSize: focused ? 44 : 26, fontWeight: 800, lineHeight: 1.1 }}>81%</div>
        <div style={{ fontSize: focused ? 15 : 11, opacity: 0.85, fontWeight: 600 }}>
          240 mi · parked
        </div>
      </>
    ),
  },
  {
    id: "dogcam",
    label: "Dog Cam",
    icon: "paw",
    gradient: "linear-gradient(160deg, #f59e0b 0%, #ea580c 55%, #9a3412 100%)",
    glow: "rgba(251,191,36,0.65)",
    scene: (focused) => (
      <>
        <Icon name="dog" s={focused ? 84 : 48} sw={1.6} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginTop: focused ? 14 : 8,
            background: "rgba(0,0,0,0.3)",
            borderRadius: 99,
            padding: focused ? "6px 14px" : "4px 10px",
          }}
        >
          <span
            className="mmc-live-dot"
            style={{
              width: focused ? 10 : 7,
              height: focused ? 10 : 7,
              borderRadius: 99,
              background: "#ff5d5d",
            }}
          />
          <span style={{ fontSize: focused ? 15 : 11, fontWeight: 800, letterSpacing: "0.14em" }}>
            LIVE
          </span>
        </div>
      </>
    ),
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: "calendar",
    gradient: "linear-gradient(160deg, #10b981 0%, #059669 55%, #065f46 100%)",
    glow: "rgba(52,211,153,0.65)",
    scene: (focused) => (
      <>
        <div style={{ fontSize: focused ? 48 : 28, fontWeight: 800, lineHeight: 1 }}>17:30</div>
        <div style={{ fontSize: focused ? 18 : 12, fontWeight: 700, marginTop: focused ? 10 : 6 }}>
          Dinner with Sam
        </div>
        {focused ? (
          <div style={{ fontSize: 14, opacity: 0.8, fontWeight: 600, marginTop: 6 }}>
            Sat · Farmers market
          </div>
        ) : null}
      </>
    ),
  },
  {
    id: "weather",
    label: "Weather",
    icon: "sun",
    gradient: "linear-gradient(160deg, #fbbf24 0%, #f97316 60%, #c2410c 100%)",
    glow: "rgba(253,224,71,0.65)",
    scene: (focused) => (
      <>
        <Icon name="cloud-sun" s={focused ? 72 : 44} sw={1.6} />
        <div
          style={{
            fontSize: focused ? 56 : 32,
            fontWeight: 800,
            lineHeight: 1.05,
            marginTop: focused ? 8 : 4,
          }}
        >
          81°
        </div>
        <div style={{ fontSize: focused ? 15 : 11, opacity: 0.85, fontWeight: 600 }}>
          Sunny · peak 84° at 17:00
        </div>
      </>
    ),
  },
];

const TICKER_ITEMS = [
  "Dinner with Sam · 17:30",
  "Farmers market · Saturday",
  "Evening setpoint 71° at 17:30",
  "Tesla charged to 81% · 240 mi",
  "Now playing: Khruangbin",
  "Outside 81° · peak 84° at 17:00",
];

function TickerRun({ runId }: { runId: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }} aria-hidden={runId === "run-b"}>
      {TICKER_ITEMS.map((item) => (
        <span
          key={`${runId}-${item}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 26,
            padding: "0 13px",
            fontSize: 16,
            fontWeight: 600,
            color: "rgba(230,235,255,0.75)",
            whiteSpace: "nowrap",
          }}
        >
          {item}
          <span style={{ color: "rgba(230,235,255,0.3)", fontSize: 12 }}>◆</span>
        </span>
      ))}
    </div>
  );
}

export function MetaphorSpringboard() {
  const [focusedId, setFocusedId] = useState<ChannelId>("climate");

  return (
    <div
      className="mmc-spring"
      style={{
        width: PANEL_W,
        height: PANEL_H,
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(1000px 620px at 50% -10%, #26264d 0%, #14142b 55%, #0b0b1a 100%)",
        color: "#f2f4ff",
      }}
    >
      <style>{SPRING_CSS}</style>

      {/* Header: greeting + big clock */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "64px 84px 0",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 21,
              fontWeight: 700,
              color: "rgba(230,235,255,0.6)",
              letterSpacing: "0.02em",
            }}
          >
            Friday · July 18
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 4 }}>
            Good afternoon, Webb House
          </div>
        </div>
        <div
          style={{
            fontSize: 128,
            fontWeight: 800,
            lineHeight: 0.9,
            letterSpacing: "-0.05em",
            background: "linear-gradient(180deg, #ffffff 30%, #8f9bff 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          14:32
        </div>
      </div>

      {/* Channel row */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: "0 40px",
        }}
      >
        {CHANNELS.map((ch) => {
          const focused = ch.id === focusedId;
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => setFocusedId(ch.id)}
              className={`mmc-channel${focused ? " mmc-focus-glow" : ""}`}
              aria-pressed={focused}
              style={{
                width: focused ? 330 : 178,
                height: focused ? 470 : 360,
                transform: focused ? "translateY(-26px)" : "translateY(0)",
                border: "none",
                cursor: "pointer",
                borderRadius: 36,
                padding: 0,
                position: "relative",
                overflow: "hidden",
                background: ch.gradient,
                color: "#fff",
                boxShadow: focused
                  ? `0 0 0 5px rgba(255,255,255,0.9), 0 0 44px 10px ${ch.glow}, 0 34px 60px rgba(0,0,0,0.55)`
                  : "0 14px 30px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.14)",
              }}
            >
              {/* soft top sheen */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "radial-gradient(120% 60% at 50% -12%, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0) 55%)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "relative",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: 18,
                }}
              >
                {ch.scene(focused)}
              </div>
              {/* channel label pill */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: focused ? 22 : 16,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(0,0,0,0.32)",
                    borderRadius: 99,
                    padding: focused ? "8px 18px" : "6px 13px",
                    fontSize: focused ? 17 : 13,
                    fontWeight: 800,
                    letterSpacing: "0.01em",
                  }}
                >
                  <Icon name={ch.icon} s={focused ? 19 : 15} sw={2} />
                  {ch.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Ticker */}
      <div
        style={{
          height: 58,
          borderTop: "1px solid rgba(230,235,255,0.14)",
          background: "rgba(10,10,26,0.6)",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 22px 0 30px",
            background: "linear-gradient(90deg, #0b0b1a 78%, rgba(11,11,26,0))",
            zIndex: 1,
            gap: 9,
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: "0.16em",
            color: "#8f9bff",
          }}
        >
          <Icon name="bell" s={16} sw={2} />
          UP NEXT
        </div>
        <div className="mmc-ticker-track" style={{ paddingLeft: 170 }}>
          <TickerRun runId="run-a" />
          <TickerRun runId="run-b" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* B , MetaphorFrontPage: The Daily Webb                               */
/* ------------------------------------------------------------------ */

const PAPER_CSS = `
.mmc-paper {
  font-family: Georgia, "Times New Roman", "New York", serif;
  -webkit-font-smoothing: antialiased;
}
.mmc-paper .mmc-sans {
  font-family: "Space Grotesk Variable", ui-rounded, system-ui, sans-serif;
}
.mmc-paper .mmc-mono {
  font-family: "Space Mono", ui-monospace, monospace;
}
.mmc-lead-headline {
  transition: opacity 0.25s ease;
}
.mmc-lead-headline:active { opacity: 0.55; }
.mmc-dropcap::first-letter {
  float: left;
  font-size: 58px;
  line-height: 0.82;
  padding: 6px 8px 0 0;
  font-weight: 700;
}
@media (prefers-reduced-motion: reduce) {
  .mmc-lead-headline { transition: none; }
}
`;

const INK = "#1c1712";
const PAPER = "#f6f1e5";
const RED = "#b3231e";
const HAIRLINE = "1px solid rgba(28,23,18,0.28)";

interface Headline {
  id: string;
  kicker: string;
  title: string;
  standfirst: string;
}

const HEADLINES: Headline[] = [
  {
    id: "lead-climate",
    kicker: "CLIMATE DESK",
    title: "HOUSE COOLS TO 72° AS AFTERNOON PEAKS AT 84°",
    standfirst:
      "Compressor engages ahead of the 17:00 high; indoor air holds a dignified 74° while humidity sits at a comfortable 46 per cent.",
  },
  {
    id: "lead-music",
    kicker: "ARTS & CULTURE",
    title: "KHRUANGBIN HOLDS LIVING ROOM CAPTIVE, WITNESSES SAY",
    standfirst:
      "“So We Won't Forget” reaches its 62nd percentile to no complaints; sources describe the bassline as “frankly unreasonable for a Friday.”",
  },
  {
    id: "lead-tesla",
    kicker: "TRANSPORT",
    title: "TESLA REPORTS 81% CHARGE, CALLS 240 MILES “PLENTY”",
    standfirst:
      "The sedan remains parked and smug in the driveway; analysts see no journeys on the books before Saturday's farmers market run.",
  },
];

const MARKET_ROWS: Array<{
  id: string;
  sym: string;
  val: string;
  dir: "up" | "down";
  note: string;
}> = [
  { id: "mkt-climate", sym: "CLIMATE", val: "72°", dir: "down", note: "cooling" },
  { id: "mkt-tesla", sym: "TESLA", val: "81%", dir: "up", note: "240 mi" },
  { id: "mkt-net", sym: "NET", val: "884", dir: "up", note: "12 dev" },
  { id: "mkt-humid", sym: "HUMID", val: "46%", dir: "down", note: "steady" },
  { id: "mkt-out", sym: "OUTDOOR", val: "81°", dir: "up", note: "pk 84°" },
];

function SunOverHouseIllustration() {
  return (
    <svg
      width="100%"
      viewBox="0 0 560 300"
      style={{ display: "block", background: "#ece4d2" }}
      role="img"
      aria-label="Editorial illustration: sun over a house"
    >
      <title>Sun over a house</title>
      {/* sky bands */}
      <rect x="0" y="0" width="560" height="300" fill="#e8ddc4" />
      <rect x="0" y="210" width="560" height="90" fill="#d8cba9" />
      {/* sun */}
      <circle cx="415" cy="92" r="52" fill={RED} />
      <g stroke={RED} strokeWidth="6" strokeLinecap="round">
        <line x1="415" y1="14" x2="415" y2="30" />
        <line x1="415" y1="154" x2="415" y2="170" />
        <line x1="337" y1="92" x2="353" y2="92" />
        <line x1="477" y1="92" x2="493" y2="92" />
        <line x1="360" y1="37" x2="371" y2="48" />
        <line x1="459" y1="136" x2="470" y2="147" />
        <line x1="470" y1="37" x2="459" y2="48" />
        <line x1="371" y1="136" x2="360" y2="147" />
      </g>
      {/* heat shimmer */}
      <g stroke="rgba(28,23,18,0.5)" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M330 190 q10 -8 20 0 t20 0" />
        <path d="M460 200 q10 -8 20 0 t20 0" />
      </g>
      {/* house */}
      <g>
        <rect x="92" y="150" width="180" height="105" fill={INK} />
        <path d="M72 152 L182 84 L292 152 Z" fill={INK} />
        <rect x="238" y="98" width="20" height="42" fill={INK} />
        {/* door + windows in paper color */}
        <rect x="162" y="192" width="40" height="63" fill="#e8ddc4" />
        <circle cx="194" cy="226" r="3.5" fill={INK} />
        <rect x="112" y="172" width="34" height="34" fill="#e8ddc4" />
        <rect x="218" y="172" width="34" height="34" fill="#e8ddc4" />
        <line x1="129" y1="172" x2="129" y2="206" stroke={INK} strokeWidth="3" />
        <line x1="112" y1="189" x2="146" y2="189" stroke={INK} strokeWidth="3" />
        <line x1="235" y1="172" x2="235" y2="206" stroke={INK} strokeWidth="3" />
        <line x1="218" y1="189" x2="252" y2="189" stroke={INK} strokeWidth="3" />
      </g>
      {/* cool air puffs from a unit */}
      <rect x="60" y="228" width="26" height="27" fill={INK} />
      <g stroke="rgba(28,23,18,0.55)" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M46 236 q-8 4 -14 0" />
        <path d="M46 248 q-10 5 -18 0" />
      </g>
      {/* dog + ball, tiny narrative */}
      <g fill={INK}>
        <ellipse cx="330" cy="248" rx="20" ry="11" />
        <circle cx="351" cy="240" r="8" />
        <path d="M355 233 l5 -8 3 9 Z" />
        <rect x="316" y="252" width="5" height="10" />
        <rect x="336" y="252" width="5" height="10" />
        <path
          d="M310 246 q-10 -4 -8 -13"
          stroke={INK}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      <circle cx="384" cy="256" r="6" fill={RED} />
      <rect x="0" y="296" width="560" height="4" fill={INK} />
    </svg>
  );
}

function Stars() {
  return (
    <span
      role="img"
      style={{ color: RED, letterSpacing: 2, fontSize: 17 }}
      aria-label="4 out of 5 stars"
    >
      ★★★★<span style={{ color: "rgba(28,23,18,0.35)" }}>☆</span>
    </span>
  );
}

export function MetaphorFrontPage() {
  const [headlineIdx, setHeadlineIdx] = useState(0);
  const lead = HEADLINES[headlineIdx % HEADLINES.length] ?? HEADLINES[0];

  return (
    <div
      className="mmc-paper"
      style={{
        width: PANEL_W,
        height: PANEL_H,
        overflow: "hidden",
        position: "relative",
        background: PAPER,
        color: INK,
        display: "flex",
        flexDirection: "column",
        padding: "26px 44px 0",
        boxSizing: "border-box",
      }}
    >
      <style>{PAPER_CSS}</style>

      {/* Top ear strip */}
      <div
        className="mmc-sans"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
          letterSpacing: "0.14em",
          fontWeight: 700,
          borderBottom: `2px solid ${INK}`,
          paddingBottom: 8,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Icon name="sun" s={15} sw={2.2} />
          74° · SUNNY
        </span>
        <span>VOL. MMXXVI · No. 199 · HOME EDITION</span>
        <span style={{ color: RED }}>FREE TO RESIDENTS · PRICELESS TO GUESTS</span>
      </div>

      {/* Masthead */}
      <div
        style={{ textAlign: "center", padding: "18px 0 14px", borderBottom: `1px solid ${INK}` }}
      >
        <div
          style={{
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: "0.015em",
            lineHeight: 0.95,
          }}
        >
          THE DAILY WEBB
        </div>
        <div
          className="mmc-sans"
          style={{
            marginTop: 10,
            fontSize: 13,
            letterSpacing: "0.28em",
            fontWeight: 700,
            display: "flex",
            justifyContent: "center",
            gap: 26,
          }}
        >
          <span>FRIDAY · JULY 18</span>
          <span style={{ color: RED }}>◆</span>
          <span>ALL THE HOUSE THAT'S FIT TO PRINT</span>
          <span style={{ color: RED }}>◆</span>
          <span>14:32 EDITION</span>
        </div>
      </div>
      <div style={{ borderBottom: `3px solid ${INK}`, marginTop: 3, marginBottom: 20 }} />

      {/* Editorial grid */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 300px 262px",
          columnGap: 0,
          minHeight: 0,
        }}
      >
        {/* Lead story */}
        <div style={{ paddingRight: 28, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <button
            type="button"
            className="mmc-lead-headline"
            onClick={() => setHeadlineIdx((i) => (i + 1) % HEADLINES.length)}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "block",
            }}
            aria-label="Cycle lead story"
          >
            <div
              className="mmc-sans"
              style={{
                fontSize: 13,
                letterSpacing: "0.22em",
                fontWeight: 700,
                color: RED,
                marginBottom: 10,
              }}
            >
              {lead.kicker} · TAP FOR NEXT LEAD
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 55,
                lineHeight: 1.02,
                fontWeight: 700,
                letterSpacing: "-0.012em",
              }}
            >
              {lead.title}
            </h1>
            <p
              style={{
                margin: "14px 0 0",
                fontSize: 20,
                lineHeight: 1.35,
                fontStyle: "italic",
                color: "rgba(28,23,18,0.82)",
                maxWidth: "58ch",
              }}
            >
              {lead.standfirst}
            </p>
          </button>

          <div style={{ margin: "18px 0 8px", border: `1px solid ${INK}` }}>
            <SunOverHouseIllustration />
          </div>
          <div
            className="mmc-sans"
            style={{
              fontSize: 11.5,
              letterSpacing: "0.06em",
              color: "rgba(28,23,18,0.65)",
              marginBottom: 14,
            }}
          >
            The afternoon sun, photographed at 14:32, negotiating with the heat pump. Illustration:
            Staff.
          </div>

          {/* Two body columns with rule */}
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 26, minHeight: 0 }}
          >
            <p
              className="mmc-dropcap"
              style={{ margin: 0, fontSize: 15.5, lineHeight: 1.5, textAlign: "justify" }}
            >
              With outdoor readings at 81 degrees and climbing toward a forecast high of 84 by five
              o'clock, the house has opted for composure. The thermostat, set to 72, describes the
              operation as routine.
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 15.5,
                lineHeight: 1.5,
                textAlign: "justify",
                borderLeft: HAIRLINE,
                paddingLeft: 26,
              }}
            >
              Twelve devices remain online across the estate, the network moving a brisk 884
              megabits. The dog could not be reached for comment, being visible on camera and
              extremely asleep.
            </p>
          </div>
        </div>

        {/* Markets + Today column */}
        <div
          style={{
            borderLeft: HAIRLINE,
            padding: "0 24px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            className="mmc-sans"
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.22em",
              borderBottom: `2px solid ${INK}`,
              paddingBottom: 7,
            }}
          >
            HOUSE MARKETS
          </div>
          <table
            className="mmc-mono"
            style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}
          >
            <tbody>
              {MARKET_ROWS.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid rgba(28,23,18,0.15)" }}>
                  <td style={{ padding: "9px 0", fontSize: 13, fontWeight: 700 }}>{r.sym}</td>
                  <td
                    style={{ padding: "9px 0", fontSize: 15, textAlign: "right", fontWeight: 700 }}
                  >
                    {r.val}
                  </td>
                  <td
                    style={{
                      padding: "9px 0 9px 8px",
                      textAlign: "right",
                      color: r.dir === "up" ? RED : "rgba(28,23,18,0.75)",
                    }}
                  >
                    <Icon name={r.dir} s={14} sw={2.6} />
                  </td>
                  <td
                    style={{
                      padding: "9px 0",
                      fontSize: 11,
                      textAlign: "right",
                      color: "rgba(28,23,18,0.55)",
                    }}
                  >
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            className="mmc-sans"
            style={{
              marginTop: 26,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.22em",
              borderBottom: `2px solid ${INK}`,
              paddingBottom: 7,
            }}
          >
            TODAY
          </div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <span
                className="mmc-mono"
                style={{ fontSize: 15, fontWeight: 700, color: RED, minWidth: 52 }}
              >
                17:30
              </span>
              <span style={{ fontSize: 17 }}>
                Dinner with Sam.{" "}
                <em style={{ color: "rgba(28,23,18,0.6)" }}>
                  Table for two; thermostat drops to 71 in sympathy.
                </em>
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <span
                className="mmc-mono"
                style={{ fontSize: 15, fontWeight: 700, color: RED, minWidth: 52 }}
              >
                SAT
              </span>
              <span style={{ fontSize: 17 }}>
                Farmers market.{" "}
                <em style={{ color: "rgba(28,23,18,0.6)" }}>
                  Early tomatoes expected. Bring bags.
                </em>
              </span>
            </div>
          </div>

          <div style={{ marginTop: "auto", paddingBottom: 18 }}>
            <div
              style={{
                borderTop: HAIRLINE,
                paddingTop: 12,
                fontSize: 13.5,
                fontStyle: "italic",
                lineHeight: 1.45,
              }}
            >
              &ldquo;A well-cooled house is the beginning of all philosophy.&rdquo;
              <span
                className="mmc-sans"
                style={{
                  fontStyle: "normal",
                  fontSize: 11,
                  display: "block",
                  marginTop: 5,
                  letterSpacing: "0.1em",
                }}
              >
                — THE THERMOSTAT, PROBABLY
              </span>
            </div>
          </div>
        </div>

        {/* Review + weather column */}
        <div
          style={{
            borderLeft: HAIRLINE,
            padding: "0 0 0 24px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              border: `2px solid ${INK}`,
              padding: "14px 16px",
            }}
          >
            <div
              className="mmc-sans"
              style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.22em", color: RED }}
            >
              NOW PLAYING · REVIEW
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, lineHeight: 1.1 }}>
              &ldquo;So We Won't Forget&rdquo;
            </div>
            <div style={{ fontSize: 15, fontStyle: "italic", marginTop: 3 }}>Khruangbin</div>
            <div style={{ marginTop: 8 }}>
              <Stars />
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.45 }}>
              Sixty-two per cent elapsed and not a note wasted. The living room speaker earns its
              wall socket.
            </p>
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 5, background: "rgba(28,23,18,0.16)" }}>
                <div style={{ height: "100%", width: "62%", background: RED }} />
              </div>
              <div
                className="mmc-mono"
                style={{
                  fontSize: 10.5,
                  marginTop: 5,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>62% THROUGH</span>
                <span>SIDE A</span>
              </div>
            </div>
          </div>

          <div
            className="mmc-sans"
            style={{
              marginTop: 24,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.22em",
              borderBottom: `2px solid ${INK}`,
              paddingBottom: 7,
            }}
          >
            THE WEATHER PAGE
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 14 }}>
            <Icon name="cloud-sun" s={44} sw={1.6} />
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>81°</div>
              <div style={{ fontSize: 13.5, color: "rgba(28,23,18,0.7)" }}>
                Sunny. High of 84° at 17:00.
              </div>
            </div>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.45, textAlign: "justify" }}>
            Indoors: 74° and falling with intent. Humidity 46 per cent, which the editors consider
            civilised. Evening setpoint of 71° scheduled for 17:30, in time for dinner.
          </p>

          <div style={{ marginTop: "auto", paddingBottom: 18 }}>
            <div
              className="mmc-sans"
              style={{
                borderTop: `2px solid ${INK}`,
                paddingTop: 8,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.2em",
              }}
            >
              DOG CAM · PAGE 12
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <Icon name="paw" s={20} sw={2} />
              <span style={{ fontSize: 14, fontStyle: "italic" }}>
                Live coverage continues around the clock.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Classifieds footer */}
      <div
        style={{
          borderTop: `3px double ${INK}`,
          margin: "0 -44px",
          padding: "10px 44px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          background: "#efe8d8",
        }}
      >
        <span style={{ fontSize: 14.5, fontStyle: "italic" }}>
          CLASSIFIEDS — LOST: one tennis ball, last seen under sofa. Reward: belly rubs. — The Dog
        </span>
        <span
          className="mmc-sans"
          style={{ fontSize: 11, letterSpacing: "0.18em", fontWeight: 700 }}
        >
          PRINTED ON RECYCLED PIXELS
        </span>
      </div>
    </div>
  );
}
