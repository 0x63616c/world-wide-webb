/* ============================================================
   DS COMPONENTS , ported verbatim from
   0x63616c/control-center @ apps/web/src/components/**
   Browser-JSX versions of the real primitives, exported to window.
   Class names + token vars match the repo's tokens.css exactly.
   ============================================================ */
var useState = React.useState,
  useEffect = React.useEffect,
  useRef = React.useRef,
  useState2 = React.useState;

/* ---------- Icon , exact 23-glyph set from components/Icon.tsx ---------- */
const GLYPHS = {
  sun: (
    <g>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </g>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4 6.4 6.4 0 0 0 20 14.5Z" />,
  cloud: <path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.5 3.5 0 0 0 7 18Z" />,
  "cloud-sun": (
    <g>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 2.5v1.5M2.5 8H4M3.8 3.8l1 1M12.2 3.8l-1 1" />
      <path d="M9 19h8a3.3 3.3 0 0 0 .3-6.6A4.6 4.6 0 0 0 9 13.5 3 3 0 0 0 9 19Z" />
    </g>
  ),
  lamp: (
    <g>
      <path d="M9 3h6l2.5 7h-11Z" />
      <path d="M12 10v8M8.5 21h7" />
    </g>
  ),
  bulb: (
    <g>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2h5c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
    </g>
  ),
  fan: (
    <g>
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 10.4c0-3 .6-6.4-2-6.4-2.2 0-2 3.4 2 6.4ZM13.6 12c3 0 6.4.6 6.4-2 0-2.2-3.4-2-6.4 2ZM12 13.6c0 3-.6 6.4 2 6.4 2.2 0 2-3.4-2-6.4ZM10.4 12c-3 0-6.4-.6-6.4 2 0 2.2 3.4 2 6.4-2Z" />
    </g>
  ),
  thermo: (
    <g>
      <path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z" />
      <path d="M12 9v6" />
    </g>
  ),
  car: (
    <g>
      <path d="M5 16h14M4.5 16l1.2-4.2A2 2 0 0 1 7.6 10h8.8a2 2 0 0 1 1.9 1.4L19.5 16M4.5 16v2.5M19.5 16v2.5" />
      <circle cx="8" cy="16.5" r="1.3" />
      <circle cx="16" cy="16.5" r="1.3" />
    </g>
  ),
  bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6Z" />,
  lock: (
    <g>
      <rect x="5.5" y="11" width="13" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </g>
  ),
  unlock: (
    <g>
      <rect x="5.5" y="11" width="13" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2" />
    </g>
  ),
  wifi: (
    <g>
      <path d="M2.5 8.5a15 15 0 0 1 19 0M5.5 11.8a10 10 0 0 1 13 0M8.5 15a5 5 0 0 1 7 0" />
      <circle cx="12" cy="18.5" r="1" />
    </g>
  ),
  pin: (
    <g>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </g>
  ),
  cam: (
    <g>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </g>
  ),
  dog: (
    <g>
      <path d="M5 9l-1-4 3 1.5M19 9l1-4-3 1.5" />
      <path d="M5 9c0 5 3 9 7 9s7-4 7-9" />
      <circle cx="9.5" cy="11" r=".6" fill="currentColor" />
      <circle cx="14.5" cy="11" r=".6" fill="currentColor" />
      <path d="M12 14l-1 1h2Z" />
    </g>
  ),
  calendar: (
    <g>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9h16M9 3v4M15 3v4" />
    </g>
  ),
  plus: <path d="M12 6v12M6 12h12" />,
  bell: (
    <g>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </g>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
};
const ICON_NAMES = Object.keys(GLYPHS);
function Icon({ name, s = 22, c = "currentColor", sw = 1.7 }) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "0 0 auto" }}
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  );
}

/* ---------- Tile ---------- */
function Tile({ padding, children, className, style, onClick }) {
  return (
    <div
      className={`tile${className ? ` ${className}` : ""}`}
      onClick={onClick}
      style={{ height: "100%", padding, display: "flex", flexDirection: "column", ...style }}
    >
      {children}
    </div>
  );
}

/* ---------- TileHeader ---------- */
function TileHeader({ icon, title, right, iconSize = 19, titleSize = 17.5 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <Icon name={icon} s={iconSize} c="var(--ink-2)" />
      <span style={{ fontSize: titleSize, fontWeight: 600, letterSpacing: "-0.015em" }}>
        {title}
      </span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

/* ---------- Pill ---------- */
const PillTone = { Default: "default", On: "on", Amber: "amber" };
function Pill({ tone = "default", children, style }) {
  const cls = tone === "default" ? "pill" : `pill ${tone}`;
  return (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}

/* ---------- Stat ---------- */
function Stat({ label, value, accent, muted, sub }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="cap">{label}</span>
      <span
        data-stat-value
        className="mono"
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: accent ? "var(--acc)" : muted ? "var(--ink-2)" : undefined,
        }}
      >
        {value}
      </span>
      {sub && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{sub}</span>}
    </div>
  );
}

/* ---------- StatusDot ---------- */
function StatusDot({ online }) {
  if (online) return <span className="dot" />;
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--ink-3)",
        display: "inline-block",
      }}
    />
  );
}

/* ---------- Skeleton ---------- */
function Skeleton({ w, h = 14, borderRadius = 6 }) {
  return (
    <div
      data-skeleton
      style={{
        width: w,
        height: h,
        borderRadius,
        background: "linear-gradient(90deg, var(--tile-2) 25%, var(--nest) 50%, var(--tile-2) 75%)",
        backgroundSize: "200%",
        animation: "shimmer 1.6s linear infinite",
      }}
    />
  );
}

/* ---------- Chip (mode toggle) ---------- */
function Chip({ active, onClick, children }) {
  return (
    <button type="button" className={`chip${active ? " on" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------- ControlTap ---------- */
function ControlTap({ icon, label, on, sub, pending, swatch, disabled, onToggle }) {
  const statusText = on ? (sub ?? "On") : "Off";
  return (
    <button
      type="button"
      className={`tap${on ? " on" : ""}`}
      onClick={onToggle}
      disabled={disabled}
      data-pending={pending ? "true" : undefined}
      aria-pressed={on}
      aria-label={label}
      style={{
        padding: "17px 17px 12px",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        background: "none",
        opacity: disabled ? 0.4 : pending ? 0.7 : 1,
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        {swatch ? (
          <span
            data-swatch=""
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: swatch,
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,.18)",
            }}
          />
        ) : icon === "fan" ? (
          <span
            data-fan-spin=""
            style={{
              display: "inline-flex",
              animation: "spin 10s linear infinite",
              animationPlayState: on ? "running" : "paused",
            }}
          >
            <Icon name="fan" s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
          </span>
        ) : (
          <Icon name={icon} s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
        )}
        <span className="sd" />
      </div>
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 500 }}>{label}</span>
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: on ? "var(--acc)" : "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: ".08em",
          }}
        >
          {statusText}
        </span>
      </div>
    </button>
  );
}

/* ---------- Switch (.sw , CSS-only in repo, wrapped here) ---------- */
function Switch({ on, onToggle }) {
  return (
    <button
      type="button"
      className={`sw${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label="toggle"
      onClick={onToggle}
      style={{ padding: 0 }}
    >
      <span className="knob" />
    </button>
  );
}

/* ---------- Range (.range , native input styled by token CSS) ---------- */
function Range({ value, onChange, min = 0, max = 100, lg, style }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange && onChange(Number(e.target.value))}
      className={`range${lg ? " range-lg" : ""}`}
      style={{ "--p": `${pct}%`, ...style }}
    />
  );
}

/* ---------- Modal (inline variant for the catalog , same markup/tokens) ---------- */
function Modal({ open, onClose, title, children, width = 640, maxHeight = 720 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const panelWidth = Math.min(width, 1280),
    panelMaxHeight = Math.min(maxHeight, 960);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="modal-backdrop"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          padding: 0,
          cursor: "default",
          background: "rgba(0,0,0,0.55)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="modal-panel"
        style={{
          position: "relative",
          width: panelWidth,
          maxHeight: panelMaxHeight,
          display: "flex",
          flexDirection: "column",
          background: "var(--tile)",
          color: "var(--ink)",
          border: "1px solid var(--hair)",
          borderRadius: "var(--r)",
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.7)",
          fontFamily: "var(--ui)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 20,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              padding: 0,
              cursor: "pointer",
              color: "var(--ink-2)",
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 10,
              font: "inherit",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="modal-scroll" style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------- BorderProgressRing (faithful port) ---------- */
function clampRadius(r, w, h) {
  return Math.max(0, Math.min(r, w / 2, h / 2));
}
function perimeterLength(w, h, r) {
  const rr = clampRadius(r, w, h);
  return 2 * (w - 2 * rr) + 2 * (h - 2 * rr) + 2 * Math.PI * rr;
}
function perimeterPath(x, y, w, h, r, dir) {
  const rr = clampRadius(r, w, h),
    cx = x + w / 2,
    right = x + w,
    bottom = y + h;
  if (dir === "cw")
    return `M ${cx} ${y} H ${right - rr} A ${rr} ${rr} 0 0 1 ${right} ${y + rr} V ${bottom - rr} A ${rr} ${rr} 0 0 1 ${right - rr} ${bottom} H ${x + rr} A ${rr} ${rr} 0 0 1 ${x} ${bottom - rr} V ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} H ${cx}`;
  return `M ${cx} ${y} H ${x + rr} A ${rr} ${rr} 0 0 0 ${x} ${y + rr} V ${bottom - rr} A ${rr} ${rr} 0 0 0 ${x + rr} ${bottom} H ${right - rr} A ${rr} ${rr} 0 0 0 ${right} ${bottom - rr} V ${y + rr} A ${rr} ${rr} 0 0 0 ${right - rr} ${y} H ${cx}`;
}
function BorderProgressRing({
  progress,
  strokeWidth = 2.5,
  color = "var(--ink-3)",
  trackColor,
  radius,
  transitionMs = 0,
  direction = "cw",
  width,
  height,
}) {
  const svgRef = useRef(null);
  const explicit = width != null && height != null;
  const [measured, setMeasured] = useState(explicit ? { w: width, h: height } : null);
  const [autoRadius, setAutoRadius] = useState(undefined);
  useEffect(() => {
    if (explicit) {
      setMeasured({ w: width, h: height });
      return;
    }
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setMeasured({ w: rect.width, h: rect.height });
      if (radius === undefined && el.parentElement) {
        const cs = getComputedStyle(el.parentElement);
        const br = parseFloat(cs.borderTopLeftRadius) || 0,
          bw = parseFloat(cs.borderTopWidth) || 0;
        setAutoRadius(Math.max(0, br - bw));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [explicit, width, height, radius]);
  const clamped = Math.min(Math.max(progress, 0), 1);
  const prev = useRef(clamped);
  const isWrap = clamped < prev.current;
  prev.current = clamped;
  const w = measured?.w ?? 0,
    h = measured?.h ?? 0,
    inset = strokeWidth / 2;
  const boxW = w - strokeWidth,
    boxH = h - strokeWidth;
  const pathRadius = (radius ?? autoRadius ?? 0) - inset;
  const drawable = boxW > 0 && boxH > 0;
  const length = drawable ? perimeterLength(boxW, boxH, pathRadius) : 0;
  const d = drawable ? perimeterPath(inset, inset, boxW, boxH, pathRadius, direction) : "";
  const dashoffset = length * (1 - clamped);
  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      viewBox={drawable ? `0 0 ${w} ${h}` : undefined}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {drawable && trackColor && (
        <path d={d} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
      )}
      {drawable && (
        <path
          data-ring-path=""
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={String(length)}
          strokeDashoffset={String(dashoffset)}
          style={{
            transition:
              isWrap || transitionMs <= 0 ? "none" : `stroke-dashoffset ${transitionMs}ms linear`,
          }}
        />
      )}
    </svg>
  );
}

Object.assign(window, {
  Icon,
  ICON_NAMES,
  Tile,
  TileHeader,
  Pill,
  PillTone,
  Stat,
  StatusDot,
  Skeleton,
  Chip,
  ControlTap,
  Switch,
  Range,
  Modal,
  BorderProgressRing,
});
