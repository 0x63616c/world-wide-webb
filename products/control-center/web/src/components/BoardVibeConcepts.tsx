/**
 * BoardVibeConcepts , round 2 of the dashboard redesign: three deliberately
 * NEW visual languages, breaking from the current Vercel-black tile chrome.
 * PROTOTYPE: mock tiles + local state only , no trpc, no pan engine. The
 * winning vibe becomes the base for the real board + hub pages.
 *
 *  A , Pop Bento: dark candy. Tinted card washes per domain, chunky rounded
 *      type, sticker pills, blob accents, squishy press feedback.
 *  B , Aurora Glass: slow-drifting gradient orbs behind frosted glass cards,
 *      gradient numerals, neon rings.
 *  C , Cream Pop: warm light panel, bold ink borders + offset shadows,
 *      saturated sticker tags , the furthest from today's board.
 */

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Icon, type IconName } from "./Icon";

// Rounded display stack , real SF Pro Rounded on the iOS wall panel.
const ROUND = 'ui-rounded, "SF Pro Rounded", "Space Grotesk Variable", system-ui, sans-serif';

const VIBE_CSS = `
@keyframes vibeDrift {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(60px, -40px) scale(1.15); }
  100% { transform: translate(0, 0) scale(1); }
}
@keyframes vibeDrift2 {
  0% { transform: translate(0, 0) scale(1.1); }
  50% { transform: translate(-70px, 50px) scale(0.95); }
  100% { transform: translate(0, 0) scale(1.1); }
}
.vibe-press { transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1); cursor: pointer; }
.vibe-press:active { transform: scale(0.96); }
@media (prefers-reduced-motion: reduce) {
  .vibe-orb { animation: none !important; }
}
`;

function VibeFrame({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: 1366,
        height: 1024,
        background: bg,
        overflow: "hidden",
        position: "relative",
        fontFamily: ROUND,
        letterSpacing: "-0.01em",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{VIBE_CSS}</style>
      {children}
    </div>
  );
}

// ─── Concept A , Pop Bento (dark candy) ────────────────────────────────────

const POP = {
  bg: "#0b0b10",
  coral: "#ff6b5e",
  mint: "#3fd9a4",
  sky: "#5aa7ff",
  lemon: "#ffd166",
  lilac: "#b78bff",
  ink: "#f4f2ff",
  dim: "rgba(244,242,255,0.55)",
  faint: "rgba(244,242,255,0.32)",
};

/** A dark card washed with its domain color; blob accent behind the value. */
function PopCard({
  hue,
  icon,
  label,
  sticker,
  children,
  style,
}: {
  hue: string;
  icon: IconName;
  label: string;
  sticker?: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="vibe-press"
      style={{
        position: "relative",
        borderRadius: 28,
        padding: "18px 20px",
        background: `linear-gradient(145deg, ${hue}26, ${hue}0d 55%, transparent)`,
        border: `1.5px solid ${hue}38`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflow: "hidden",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          right: -34,
          bottom: -34,
          width: 130,
          height: 130,
          borderRadius: "50%",
          background: `${hue}1f`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            background: hue,
            color: "#0b0b10",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} s={19} sw={2.4} />
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: POP.ink }}>{label}</span>
        {sticker ? (
          <span
            style={{
              marginLeft: "auto",
              padding: "4px 12px",
              borderRadius: 999,
              background: hue,
              color: "#0b0b10",
              fontSize: 12.5,
              fontWeight: 800,
              transform: "rotate(2deg)",
            }}
          >
            {sticker}
          </span>
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}

function PopValue({ value, sub, hue }: { value: string; sub?: string; hue: string }) {
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 46,
          fontWeight: 800,
          lineHeight: 1,
          color: hue,
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </span>
      {sub ? <span style={{ fontSize: 13, fontWeight: 600, color: POP.dim }}>{sub}</span> : null}
    </div>
  );
}

export function BoardVibePopBento() {
  const [lamp, setLamp] = useState(true);
  const [spots, setSpots] = useState(false);
  return (
    <VibeFrame bg={POP.bg}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr 1fr 1fr",
          gridTemplateRows: "1.2fr 1fr 1fr",
          gap: 16,
          padding: 22,
        }}
      >
        {/* Hero clock spans tall left */}
        <div
          className="vibe-press"
          style={{
            gridRow: "1 / span 2",
            borderRadius: 32,
            background: `linear-gradient(160deg, ${POP.lilac}30, ${POP.sky}14 60%, transparent)`,
            border: `1.5px solid ${POP.lilac}40`,
            padding: 28,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: 6,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: -60,
              right: -60,
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: `${POP.lilac}22`,
            }}
          />
          <span style={{ fontSize: 20, fontWeight: 700, color: POP.dim }}>Friday</span>
          <span
            style={{
              fontSize: 128,
              fontWeight: 800,
              lineHeight: 0.95,
              color: POP.ink,
              letterSpacing: "-0.05em",
            }}
          >
            14:32
          </span>
          <span style={{ fontSize: 17, fontWeight: 600, color: POP.dim, marginTop: 8 }}>
            Sunny outside · house is chill 🏡
          </span>
        </div>

        <PopCard hue={POP.lemon} icon="cloud-sun" label="Weather" sticker="SUNNY">
          <PopValue value="74°" sub="feels 76° · peak 84° at 5pm" hue={POP.lemon} />
        </PopCard>
        <PopCard hue={POP.mint} icon="thermo" label="Climate" sticker="COOLING">
          <PopValue value="72°" sub="ambient 74° · 46% humidity" hue={POP.mint} />
        </PopCard>
        <PopCard hue={POP.coral} icon="car" label="Tesla">
          <PopValue value="81%" sub="240 mi · done charging 6:10" hue={POP.coral} />
        </PopCard>

        <PopCard
          hue={POP.lilac}
          icon="speaker"
          label="Now Playing"
          sticker="LIVE"
          style={{ gridColumn: "span 2" }}
        >
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: `linear-gradient(135deg, ${POP.lilac}, ${POP.sky})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0b0b10",
              }}
            >
              <Icon name="speaker" s={24} sw={2.2} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: POP.ink }}>
                So We Won't Forget
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: POP.dim }}>
                Khruangbin · Living Room
              </span>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "rgba(244,242,255,0.12)",
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    width: "62%",
                    height: "100%",
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${POP.lilac}, ${POP.sky})`,
                  }}
                />
              </div>
            </div>
          </div>
        </PopCard>
        <PopCard hue={POP.sky} icon="wifi" label="Network" sticker="884 MBPS">
          <PopValue value="12" sub="devices online · all good" hue={POP.sky} />
        </PopCard>

        <PopCard hue={POP.lemon} icon="lamp" label="Lights">
          <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
            {[
              { key: "lamp", label: "Lamp", on: lamp, toggle: () => setLamp(!lamp) },
              { key: "spots", label: "Spots", on: spots, toggle: () => setSpots(!spots) },
            ].map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={b.toggle}
                className="vibe-press"
                style={{
                  flex: 1,
                  padding: "12px 10px",
                  borderRadius: 16,
                  border: "none",
                  background: b.on ? POP.lemon : "rgba(244,242,255,0.08)",
                  color: b.on ? "#0b0b10" : POP.dim,
                  fontSize: 14,
                  fontWeight: 800,
                  fontFamily: ROUND,
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </PopCard>
        <PopCard hue={POP.mint} icon="calendar" label="Up Next">
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: POP.ink }}>
              5:30 · Dinner with Sam
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: POP.dim }}>
              Sat · Farmers market
            </span>
          </div>
        </PopCard>
        <PopCard hue={POP.coral} icon="cam" label="Dog Cam" sticker="LIVE">
          <div
            style={{
              flex: 1,
              marginTop: 6,
              borderRadius: 18,
              background: "rgba(244,242,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: POP.faint,
            }}
          >
            <Icon name="paw" s={30} sw={2} />
          </div>
        </PopCard>
        <PopCard hue={POP.sky} icon="dog" label="Dog Mode">
          <PopValue value="Off" sub="tap to start pup patrol" hue={POP.sky} />
        </PopCard>
      </div>
    </VibeFrame>
  );
}

// ─── Concept B , Aurora Glass ──────────────────────────────────────────────

const AUR = {
  bg: "#050508",
  ink: "#f2f4ff",
  dim: "rgba(242,244,255,0.55)",
  glass: "rgba(255,255,255,0.055)",
  edge: "rgba(255,255,255,0.14)",
  cyan: "#4be1ec",
  violet: "#8b7bff",
  rose: "#ff7ac2",
  lime: "#b7f36b",
};

function GlassCard({
  icon,
  label,
  glow,
  children,
  style,
}: {
  icon: IconName;
  label: string;
  glow: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="vibe-press"
      style={{
        borderRadius: 24,
        background: AUR.glass,
        border: `1px solid ${AUR.edge}`,
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 0 40px -18px ${glow}`,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ color: glow, display: "flex" }}>
          <Icon name={icon} s={17} sw={2.2} />
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: AUR.dim,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

function GradientValue({
  value,
  from,
  to,
  sub,
}: {
  value: string;
  from: string;
  to: string;
  sub?: string;
}) {
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        style={{
          fontSize: 52,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          background: `linear-gradient(120deg, ${from}, ${to})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {value}
      </span>
      {sub ? <span style={{ fontSize: 13, fontWeight: 600, color: AUR.dim }}>{sub}</span> : null}
    </div>
  );
}

export function BoardVibeAuroraGlass() {
  return (
    <VibeFrame bg={AUR.bg}>
      {/* Drifting aurora orbs */}
      <span
        className="vibe-orb"
        style={{
          position: "absolute",
          top: -180,
          left: 120,
          width: 640,
          height: 640,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${AUR.violet}55, transparent 65%)`,
          filter: "blur(60px)",
          animation: "vibeDrift 26s ease-in-out infinite",
        }}
      />
      <span
        className="vibe-orb"
        style={{
          position: "absolute",
          bottom: -220,
          right: -60,
          width: 720,
          height: 720,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${AUR.cyan}44, transparent 65%)`,
          filter: "blur(70px)",
          animation: "vibeDrift2 32s ease-in-out infinite",
        }}
      />
      <span
        className="vibe-orb"
        style={{
          position: "absolute",
          top: 340,
          left: -160,
          width: 480,
          height: 480,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${AUR.rose}3c, transparent 65%)`,
          filter: "blur(60px)",
          animation: "vibeDrift 38s ease-in-out infinite reverse",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gridTemplateRows: "auto 1fr 1fr",
          gap: 16,
          padding: 24,
        }}
      >
        {/* Slim hero band */}
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 24,
            borderRadius: 24,
            background: AUR.glass,
            border: `1px solid ${AUR.edge}`,
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
            padding: "18px 28px",
          }}
        >
          <span
            style={{
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              background: `linear-gradient(120deg, ${AUR.cyan}, ${AUR.violet}, ${AUR.rose})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            14:32
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: AUR.ink }}>Friday afternoon</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: AUR.dim }}>
              sunny · 81° outside · all systems glowing
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {[
              { key: "cool", label: "cooling", hue: AUR.cyan },
              { key: "wifi", label: "884 mbps", hue: AUR.lime },
              { key: "play", label: "playing", hue: AUR.rose },
            ].map((p) => (
              <span
                key={p.key}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: `1px solid ${p.hue}66`,
                  color: p.hue,
                  fontSize: 12.5,
                  fontWeight: 700,
                  boxShadow: `0 0 18px -6px ${p.hue}`,
                }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>

        <GlassCard icon="thermo" label="Climate" glow={AUR.cyan} style={{ gridRow: "2 / span 2" }}>
          {/* Neon setpoint ring */}
          <div style={{ margin: "auto", position: "relative", width: 190, height: 190 }}>
            <svg
              width="190"
              height="190"
              viewBox="0 0 190 190"
              role="img"
              aria-label="Setpoint 72 degrees"
            >
              <circle
                cx="95"
                cy="95"
                r="82"
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="10"
              />
              <circle
                cx="95"
                cy="95"
                r="82"
                fill="none"
                stroke={AUR.cyan}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray="515"
                strokeDashoffset="180"
                transform="rotate(-90 95 95)"
                style={{ filter: `drop-shadow(0 0 8px ${AUR.cyan})` }}
              />
            </svg>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 54, fontWeight: 800, color: AUR.ink, lineHeight: 1 }}>
                72°
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: AUR.dim }}>
                cooling · 74° now
              </span>
            </div>
          </div>
          <span style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: AUR.dim }}>
            46% humidity · fan auto
          </span>
        </GlassCard>

        <GlassCard icon="cloud-sun" label="Weather" glow={AUR.violet}>
          <GradientValue value="74°" from={AUR.violet} to={AUR.rose} sub="peak 84° at 5pm" />
        </GlassCard>
        <GlassCard
          icon="speaker"
          label="Now Playing"
          glow={AUR.rose}
          style={{ gridColumn: "span 2" }}
        >
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: AUR.ink }}>
              Khruangbin — So We Won't Forget
            </span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 30 }}>
              {"c12 c22 c16 c28 c20 c26 c14 c24 c18 c27 c15 c23 c19 c25 c13 c21"
                .split(" ")
                .map((bar) => (
                  <span
                    key={bar}
                    style={{
                      width: 5,
                      height: Number(bar.slice(1)),
                      borderRadius: 3,
                      background: `linear-gradient(180deg, ${AUR.rose}, ${AUR.violet})`,
                      opacity: 0.9,
                    }}
                  />
                ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard icon="car" label="Tesla" glow={AUR.lime}>
          <GradientValue value="81%" from={AUR.lime} to={AUR.cyan} sub="240 mi range" />
        </GlassCard>
        <GlassCard icon="cam" label="Dog Cam" glow={AUR.violet}>
          <div
            style={{
              flex: 1,
              marginTop: 6,
              borderRadius: 16,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${AUR.edge}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: AUR.dim,
            }}
          >
            <Icon name="paw" s={26} sw={2} />
          </div>
        </GlassCard>
        <GlassCard icon="calendar" label="Up Next" glow={AUR.rose}>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: AUR.ink }}>
              5:30 · Dinner with Sam
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: AUR.dim }}>
              Sat · Farmers market
            </span>
          </div>
        </GlassCard>
      </div>
    </VibeFrame>
  );
}

// ─── Concept C , Cream Pop (light, sticker energy) ─────────────────────────

const CREAM = {
  bg: "#f4efe6",
  ink: "#211d18",
  dim: "#6f675c",
  card: "#fffdf8",
  coral: "#ff5c4d",
  teal: "#0aa58c",
  blue: "#2f6bff",
  yellow: "#ffc531",
  purple: "#7a5cff",
};

function CreamCard({
  icon,
  label,
  accent,
  tag,
  tagRotate = -2,
  children,
  style,
}: {
  icon: IconName;
  label: string;
  accent: string;
  tag?: string;
  tagRotate?: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="vibe-press"
      style={{
        position: "relative",
        borderRadius: 22,
        background: CREAM.card,
        border: `2px solid ${CREAM.ink}`,
        boxShadow: `5px 6px 0 ${accent}`,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: accent,
            border: `2px solid ${CREAM.ink}`,
            color: CREAM.ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} s={17} sw={2.4} />
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, color: CREAM.ink }}>{label}</span>
        {tag ? (
          <span
            style={{
              marginLeft: "auto",
              padding: "3px 11px",
              borderRadius: 999,
              background: CREAM.ink,
              color: CREAM.bg,
              fontSize: 12,
              fontWeight: 800,
              transform: `rotate(${tagRotate}deg)`,
            }}
          >
            {tag}
          </span>
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

function CreamValue({ value, sub }: { value: string; sub?: string }) {
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 44,
          fontWeight: 800,
          lineHeight: 1,
          color: CREAM.ink,
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </span>
      {sub ? <span style={{ fontSize: 13, fontWeight: 700, color: CREAM.dim }}>{sub}</span> : null}
    </div>
  );
}

export function BoardVibeCreamPop() {
  const [lamp, setLamp] = useState(true);
  return (
    <VibeFrame bg={CREAM.bg}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "1.25fr 1fr 1fr 1fr",
          gridTemplateRows: "1.15fr 1fr 1fr",
          gap: 18,
          padding: 24,
          color: CREAM.ink,
        }}
      >
        <div
          className="vibe-press"
          style={{
            gridRow: "1 / span 2",
            borderRadius: 26,
            background: CREAM.yellow,
            border: `2px solid ${CREAM.ink}`,
            boxShadow: `6px 7px 0 ${CREAM.ink}`,
            padding: 28,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: 4,
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 800 }}>Friday ☀️</span>
          <span
            style={{ fontSize: 124, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.05em" }}
          >
            14:32
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
            sunny · 81° out · house is happy
          </span>
        </div>

        <CreamCard icon="cloud-sun" label="Weather" accent={CREAM.blue} tag="SUNNY">
          <CreamValue value="74°" sub="peak 84° at 5pm" />
        </CreamCard>
        <CreamCard icon="thermo" label="Climate" accent={CREAM.teal} tag="COOLING" tagRotate={2}>
          <CreamValue value="72°" sub="ambient 74° · 46% rh" />
        </CreamCard>
        <CreamCard icon="car" label="Tesla" accent={CREAM.coral}>
          <CreamValue value="81%" sub="240 mi · parked" />
        </CreamCard>

        <CreamCard
          icon="speaker"
          label="Now Playing"
          accent={CREAM.purple}
          tag="LIVE"
          style={{ gridColumn: "span 2" }}
        >
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>Khruangbin — So We Won't Forget</span>
            <div
              style={{
                height: 12,
                borderRadius: 999,
                border: `2px solid ${CREAM.ink}`,
                background: CREAM.bg,
                overflow: "hidden",
              }}
            >
              <div style={{ width: "62%", height: "100%", background: CREAM.purple }} />
            </div>
          </div>
        </CreamCard>
        <CreamCard icon="wifi" label="Network" accent={CREAM.teal} tag="FAST" tagRotate={3}>
          <CreamValue value="884" sub="mbps · 12 devices" />
        </CreamCard>

        <CreamCard icon="lamp" label="Lights" accent={CREAM.yellow}>
          <button
            type="button"
            onClick={() => setLamp(!lamp)}
            className="vibe-press"
            style={{
              marginTop: "auto",
              padding: "12px 14px",
              borderRadius: 14,
              border: `2px solid ${CREAM.ink}`,
              background: lamp ? CREAM.yellow : CREAM.bg,
              color: CREAM.ink,
              fontSize: 14.5,
              fontWeight: 800,
              fontFamily: ROUND,
              boxShadow: lamp ? `3px 3px 0 ${CREAM.ink}` : "none",
            }}
          >
            Lamp {lamp ? "on" : "off"}
          </button>
        </CreamCard>
        <CreamCard icon="calendar" label="Up Next" accent={CREAM.blue}>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14.5, fontWeight: 800 }}>5:30 · Dinner with Sam</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: CREAM.dim }}>
              Sat · Farmers market
            </span>
          </div>
        </CreamCard>
        <CreamCard icon="cam" label="Dog Cam" accent={CREAM.coral} tag="LIVE" tagRotate={-3}>
          <div
            style={{
              flex: 1,
              marginTop: 6,
              borderRadius: 14,
              border: `2px solid ${CREAM.ink}`,
              background: "#e9e2d5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: CREAM.dim,
            }}
          >
            <Icon name="paw" s={28} sw={2.2} />
          </div>
        </CreamCard>
      </div>
    </VibeFrame>
  );
}
