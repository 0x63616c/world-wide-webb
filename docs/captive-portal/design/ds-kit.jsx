// ds-kit.jsx, documentation UI primitives for the Design System page.
// Depends on components.jsx (icons) being loaded first. Exports to window.

const { CheckIcon: DSCheck, ArrowRight: DSArrow } = window;

/* Section wrapper with eyebrow + title + lead */
function Section({ id, eyebrow, title, lead, children }) {
  return (
    <section className="ds-section" id={id}>
      <div className="ds-sec-head">
        {eyebrow && <div className="ds-eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {lead && <p>{lead}</p>}
      </div>
      {children}
    </section>
  );
}

function Sub({ title, tag }) {
  return (
    <div className="ds-sub">
      <h3>{title}</h3>
      {tag && <span className="ds-sub-tag">{tag}</span>}
      <span className="ds-sub-line" />
    </div>
  );
}

function Lead({ children }) {
  return <p className="ds-lead">{children}</p>;
}

/* Specimen, a black portal-surface stage that frames live components */
function Specimen({ label, tag, stretch, children }) {
  return (
    <div className="ds-specimen">
      <div className="ds-specimen-bar">
        <span className="ds-specimen-label">{label}</span>
        {tag && <span className="ds-specimen-tag">{tag}</span>}
      </div>
      <div className={"ds-specimen-body" + (stretch ? " is-stretch" : "")}>{children}</div>
    </div>
  );
}

/* StateGrid, one cell per state, each with name + trigger + live demo */
function StateGrid({ cols = 3, items }) {
  return (
    <div className="ds-specimen-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {items.map((it, i) => (
        <div className="ds-specimen-cell" key={i}>
          <div className="ds-cell-demo">{it.demo}</div>
          <div className="ds-cell-meta">
            <span className="ds-cell-name">{it.name}</span>
            {it.trigger && <span className="ds-cell-trigger">{it.trigger}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* Callout note: tag is one of spec|impl|a11y|edge|copy|do|dont */
function Note({ tag = "spec", children }) {
  const labels = {
    spec: "Spec",
    impl: "Impl",
    a11y: "A11y",
    edge: "Edge",
    copy: "Copy",
    do: "Do",
    dont: "Don’t",
  };
  return (
    <div className="ds-note">
      <span className={"ds-note-tag tag-" + tag}>{labels[tag] || tag}</span>
      <div className="ds-note-body">{children}</div>
    </div>
  );
}
function Notes({ children }) {
  return <div className="ds-notes">{children}</div>;
}

/* Generic spec table from columns + rows (rows are arrays of cells) */
function Table({ head, rows }) {
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Color swatches */
function Swatches({ items }) {
  return (
    <div className="ds-swatches">
      {items.map((s, i) => (
        <div className="ds-swatch" key={i}>
          <div
            className="ds-swatch-chip"
            style={{
              background: s.value,
              ...(s.checker
                ? {
                    backgroundImage:
                      "linear-gradient(45deg,#222 25%,transparent 25%,transparent 75%,#222 75%),linear-gradient(45deg,#222 25%,#000 25%,#000 75%,#222 75%)",
                    backgroundSize: "12px 12px",
                    backgroundPosition: "0 0,6px 6px",
                  }
                : {}),
            }}
          >
            {s.checker && <div style={{ width: "100%", height: "100%", background: s.value }} />}
          </div>
          <div className="ds-swatch-meta">
            <div className="ds-swatch-name">{s.name}</div>
            <div className="ds-swatch-var">{s.var}</div>
            <div className="ds-swatch-hex">{s.hex}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* Type scale rows */
function TypeRow({ spec, children }) {
  return (
    <div className="ds-type-row">
      <div className="ds-type-spec">{spec}</div>
      <div className="ds-type-sample">{children}</div>
    </div>
  );
}

/* Icon grid */
function IconGrid({ items }) {
  return (
    <div className="ds-icons">
      {items.map((it, i) => (
        <div className="ds-icon-cell" key={i}>
          {it.icon}
          <span className="ds-icon-name">{it.name}</span>
        </div>
      ))}
    </div>
  );
}

/* Flow node + arrow */
function FlowNode({ k, t, d, variant }) {
  return (
    <div
      className={
        "ds-node" +
        (variant === "terminal" ? " is-terminal" : "") +
        (variant === "error" ? " is-error" : "")
      }
    >
      <div className="ds-node-k">{k}</div>
      <div className="ds-node-t">{t}</div>
      {d && <div className="ds-node-d">{d}</div>}
    </div>
  );
}
function FlowArrow() {
  return <div className="ds-flow-arrow">{DSArrow ? <DSArrow /> : "→"}</div>;
}

/* Screen spec card */
function ScreenCard({ idx, name, route, rows }) {
  return (
    <div className="ds-screen">
      <div className="ds-screen-head">
        <span className="ds-screen-idx">{idx}</span>
        <span className="ds-screen-name">{name}</span>
        {route && <span className="ds-screen-route">{route}</span>}
      </div>
      <div className="ds-screen-body">
        {rows.map((r, i) => (
          <div className="ds-kv" key={i}>
            <div className="ds-kv-k">{r.k}</div>
            <div className="ds-kv-v">{r.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ kind, children }) {
  return <span className={"ds-chip" + (kind ? " " + kind : "")}>{children}</span>;
}
function Chips({ children }) {
  return <div className="ds-chips">{children}</div>;
}

/* Do / Don't list */
function ChecklistCard({ title, icon, items }) {
  return (
    <div className="ds-card-block">
      <h4>
        {icon}
        {title}
      </h4>
      <ul className="ds-list">
        {items.map((it, i) => (
          <li key={i}>
            <span className={it.bad ? "cross" : "tick"}>
              {it.bad ? "✕" : DSCheck ? <DSCheck /> : "✓"}
            </span>
            <span>{it.children}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

Object.assign(window, {
  Section,
  Sub,
  Lead,
  Specimen,
  StateGrid,
  Note,
  Notes,
  Table,
  Swatches,
  TypeRow,
  IconGrid,
  FlowNode,
  FlowArrow,
  ScreenCard,
  Chip,
  Chips,
  ChecklistCard,
});
