// ds-foundations.jsx, Foundations content: color, type, spacing, radius, elevation, icons.
// Depends on ds-kit.jsx + components.jsx. Exports <Foundations/> to window.

const { Section, Sub, Lead, Swatches, TypeRow, IconGrid, Table, Notes, Note } = window;
const {
  MailIcon,
  UserIcon,
  LockIcon,
  AlertIcon,
  CheckIcon,
  WifiIcon,
  GlobeMark,
  ArrowLeft,
  ArrowRight,
} = window;

function ColorSection() {
  return (
    <Section
      id="color"
      eyebrow="Foundations"
      title="Color"
      lead="One near-black canvas, a tight grayscale ramp for text and lines, and a single white primary. Color appears only to signal state, red for errors, green for success, never for decoration."
    >
      <Sub title="Surfaces & lines" tag="background → borders" />
      <Swatches
        items={[
          { name: "Background", var: "--background", hex: "#000000", value: "#000000" },
          { name: "Card", var: "--card", hex: "#0a0a0a", value: "#0a0a0a" },
          { name: "Card elevated", var: "--card-elevated", hex: "#111111", value: "#111111" },
          { name: "Input fill", var: "-", hex: "#0c0c0c", value: "#0c0c0c" },
          { name: "Border", var: "--border", hex: "#1f1f1f", value: "#1f1f1f" },
          { name: "Border strong", var: "--border-strong", hex: "#2b2b2b", value: "#2b2b2b" },
        ]}
      />
      <Sub title="Text" tag="3-step ramp" />
      <Swatches
        items={[
          { name: "Foreground", var: "--foreground", hex: "#fafafa", value: "#fafafa" },
          { name: "Muted", var: "--muted-foreground", hex: "#a1a1a1", value: "#a1a1a1" },
          { name: "Faint", var: "--faint-foreground", hex: "#6b6b6b", value: "#6b6b6b" },
        ]}
      />
      <Sub title="Primary & state" tag="use sparingly" />
      <Swatches
        items={[
          { name: "Primary", var: "--primary", hex: "#ffffff", value: "#ffffff" },
          { name: "On primary", var: "--primary-foreground", hex: "#0a0a0a", value: "#0a0a0a" },
          { name: "Destructive", var: "--destructive", hex: "#ff5a5f", value: "#ff5a5f" },
          { name: "Success", var: "--success", hex: "#4cc38a", value: "#4cc38a" },
          {
            name: "Focus ring",
            var: "--ring",
            hex: "rgba(255,255,255,.65)",
            value: "rgba(255,255,255,0.65)",
            checker: true,
          },
        ]}
      />
      <Notes>
        <Note tag="spec">
          State colors only ever appear at low alpha for fills (<code>9%</code>) and borders (
          <code>32–34%</code>). Solid <code>--destructive</code> / <code>--success</code> are
          reserved for icons, text and focus rings, never large fills.
        </Note>
        <Note tag="impl">
          Every value above is a CSS custom property on <code>:root</code> in <code>theme.css</code>
          . Reference the token, never the raw hex, so the corner-radius and color themes stay
          swappable.
        </Note>
        <Note tag="a11y">
          Foreground on background ≈ 20:1, muted ≈ 9:1, faint ≈ 4.7:1, all pass WCAG AA. Don’t take
          text below <code>--faint-foreground</code> on <code>--background</code>.
        </Note>
      </Notes>
    </Section>
  );
}

function TypeSection() {
  return (
    <Section
      id="type"
      eyebrow="Foundations"
      title="Typography"
      lead="Geist for everything human-readable; Geist Mono for codes, timers, emails and technical labels. Tight negative tracking on headings, comfortable line-height on body."
    >
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 14,
          background: "var(--card)",
          padding: "4px 22px",
          margin: "8px 0 4px",
        }}
      >
        <TypeRow
          spec={
            <>
              <b>Display / H1-xl</b>
              <br />
              30px · 600 · -0.03em
              <br />
              .wwb-h1-xl
            </>
          }
        >
          <span
            style={{
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: "var(--foreground)",
            }}
          >
            You’re almost online.
          </span>
        </TypeRow>
        <TypeRow
          spec={
            <>
              <b>Heading / H1</b>
              <br />
              20px · 600 · -0.02em
              <br />
              .wwb-h1
            </>
          }
        >
          <span
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--foreground)",
            }}
          >
            Check your email
          </span>
        </TypeRow>
        <TypeRow
          spec={
            <>
              <b>Body</b>
              <br />
              14px · 400 · 1.55
              <br />
              .wwb-sub
            </>
          }
        >
          <span style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted-foreground)" }}>
            Enter the 6-digit code we sent to confirm it’s you.
          </span>
        </TypeRow>
        <TypeRow
          spec={
            <>
              <b>Label</b>
              <br />
              13px · 500 · -0.005em
              <br />
              .wwb-label
            </>
          }
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>
            Wi-Fi password
          </span>
        </TypeRow>
        <TypeRow
          spec={
            <>
              <b>Caption / error</b>
              <br />
              12.5px · 400
              <br />
              .wwb-error · .wwb-foot
            </>
          }
        >
          <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
            By connecting you agree to the terms of use.
          </span>
        </TypeRow>
        <TypeRow
          spec={
            <>
              <b>Mono</b>
              <br />
              Geist Mono · 12.5px
              <br />
              .wwb-mono-faint
            </>
          }
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              color: "var(--faint-foreground)",
            }}
          >
            john@example.com
          </span>
        </TypeRow>
        <TypeRow
          spec={
            <>
              <b>Mono / numeric</b>
              <br />
              Geist Mono · 30px · tabular
              <br />
              .wwb-countdown
            </>
          }
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 30,
              fontWeight: 500,
              color: "var(--foreground)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            4:57
          </span>
        </TypeRow>
      </div>
      <Notes>
        <Note tag="impl">
          Load Geist + Geist Mono (weights 400/500/600/700). The stack falls back to{" "}
          <code>system-ui</code>; verify the webfont is actually served on the gateway, captive
          portals often block external font CDNs, so <b>self-host the woff2</b>.
        </Note>
        <Note tag="copy">
          Headings use a real apostrophe (’) and en-dash (–). Keep them, they render correctly in
          Geist and read as intentional.
        </Note>
        <Note tag="a11y">
          All sizes are in <code>px</code> for layout stability inside the portal webview, but never
          go below <b>12.5px</b>. Codes/timers use <code>tabular-nums</code> so digits don’t jitter
          as they count down.
        </Note>
      </Notes>
    </Section>
  );
}

function ShapeSection() {
  return (
    <Section
      id="shape"
      eyebrow="Foundations"
      title="Spacing, radius & elevation"
      lead="A small, deliberate set of radii and one elevation language. Spacing follows a loose 4px rhythm; gaps are owned by flex/grid containers, never ad-hoc margins."
    >
      <Sub title="Radius" tag="3 tokens" />
      <div className="ds-scale">
        {[
          { r: 7, label: "--radius-sm", use: "chips, tags" },
          { r: 9, label: "--radius-control", use: "inputs, buttons, OTP" },
          { r: 14, label: "--radius-card", use: "cards, specimens" },
          { r: 999, label: "pill", use: "status badge" },
        ].map((s, i) => (
          <div className="ds-scale-item" key={i}>
            <div className="ds-scale-radius" style={{ borderRadius: s.r }} />
            <div className="ds-scale-meta">
              <b>{s.r === 999 ? "999px" : s.r + "px"}</b>
              <br />
              {s.label}
              <br />
              <span style={{ color: "var(--faint-foreground)" }}>{s.use}</span>
            </div>
          </div>
        ))}
      </div>
      <Note tag="impl">
        Corner style is themeable: the prototype’s <code>cornerStyle</code> tweak rewrites{" "}
        <code>--radius-card</code> / <code>--radius-control</code> at runtime (sharp 6/5 · soft 14/9
        · round 20/13). Default ship value is <b>soft</b>.
      </Note>

      <Sub title="Spacing rhythm" tag="container gap" />
      <div className="ds-scale">
        {[6, 8, 10, 14, 16, 18, 22, 24, 32].map((n, i) => (
          <div className="ds-scale-item" key={i}>
            <div className="ds-scale-box" style={{ width: n, height: 40, borderRadius: 3 }} />
            <div className="ds-scale-meta">
              <b>{n}</b>
            </div>
          </div>
        ))}
      </div>
      <Notes>
        <Note tag="spec">
          Form fields stack with <code>gap: 16px</code>; the landing card padding is{" "}
          <code>30px</code> (mobile <code>18px</code> stage padding). Vertical stage padding is{" "}
          <code>24px</code>, content centered with <code>margin: auto</code>.
        </Note>
        <Note tag="impl">
          Use flex/grid <code>gap</code> for any group of siblings, buttons, OTP boxes, chips. Don’t
          space with per-child margins; it breaks when items are added or reordered.
        </Note>
      </Notes>

      <Sub title="Elevation" tag="2 shadows" />
      <Table
        head={["Token", "Shadow", "Used on"]}
        rows={[
          [
            <span className="mono">card</span>,
            <span className="mono">
              0 1px 0 rgba(255,255,255,.04) inset, 0 24px 60px -20px rgba(0,0,0,.9)
            </span>,
            "Cards, specimen stages",
          ],
          [
            <span className="mono">mark</span>,
            <span className="mono">
              0 1px 0 rgba(255,255,255,.05) inset, 0 8px 24px rgba(0,0,0,.6)
            </span>,
            "Logo mark",
          ],
          [
            <span className="mono">focus ring</span>,
            <span className="mono">0 0 0 3px rgba(255,255,255,.10)</span>,
            "Inputs, OTP, checkbox on focus",
          ],
        ]}
      />
      <Note tag="spec">
        Depth on black comes from a <b>1px top inset highlight + a soft ambient drop shadow</b>, not
        from lighter fills. The page also carries a fixed radial glow + masked grid backdrop (
        <code>.wwb-backdrop</code>, <code>.wwb-grid</code>) behind all content at{" "}
        <code>z-index:0</code>.
      </Note>
    </Section>
  );
}

function IconSection() {
  return (
    <Section
      id="icons"
      eyebrow="Foundations"
      title="Iconography"
      lead="A single line-icon family: 24px viewBox, ~1.6 stroke, round caps and joins, drawn in currentColor so they inherit text color. No filled or duotone icons."
    >
      <IconGrid
        items={[
          {
            name: "globe",
            icon: (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <GlobeMark />
              </svg>
            ),
          },
          { name: "mail", icon: <MailIcon /> },
          { name: "user", icon: <UserIcon /> },
          { name: "lock", icon: <LockIcon /> },
          { name: "wifi", icon: <WifiIcon /> },
          { name: "alert", icon: <AlertIcon /> },
          { name: "check", icon: <CheckIcon /> },
          { name: "arrow-left", icon: <ArrowLeft /> },
          { name: "arrow-right", icon: <ArrowRight /> },
        ]}
      />
      <Notes>
        <Note tag="spec">
          Render at <b>13–26px</b> depending on context: 13px inline in errors, 16px in
          fields/alerts, 22–26px inside the 56px status rings. Stroke width stays visually ~1.6,
          don’t scale a 24px icon past 28px without thinning the stroke.
        </Note>
        <Note tag="impl">
          Icons are inline SVG components using <code>stroke="currentColor"</code>. Set color on the
          parent; never hard-code a hex on the path. All decorative icons carry{" "}
          <code>aria-hidden="true"</code>.
        </Note>
        <Note tag="dont">
          Don’t introduce a second icon set (filled, emoji, brand glyphs). The portal’s entire
          visual signal is this one hairline family.
        </Note>
      </Notes>
    </Section>
  );
}

function Foundations() {
  return (
    <React.Fragment>
      <ColorSection />
      <TypeSection />
      <ShapeSection />
      <IconSection />
    </React.Fragment>
  );
}

Object.assign(window, { Foundations });
