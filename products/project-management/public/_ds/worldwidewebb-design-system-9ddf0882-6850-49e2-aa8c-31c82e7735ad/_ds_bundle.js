/* @ds-bundle: {"format":3,"namespace":"WorldWideWebbDesignSystem_9ddf08","components":[{"name":"Button","sourcePath":"components/controls/Button.jsx"},{"name":"Chip","sourcePath":"components/controls/Chip.jsx"},{"name":"ControlTap","sourcePath":"components/controls/ControlTap.jsx"},{"name":"Switch","sourcePath":"components/controls/Switch.jsx"},{"name":"GLYPHS","sourcePath":"components/core/Icon.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"PillTone","sourcePath":"components/core/Pill.jsx"},{"name":"Pill","sourcePath":"components/core/Pill.jsx"},{"name":"Skeleton","sourcePath":"components/core/Skeleton.jsx"},{"name":"Stat","sourcePath":"components/core/Stat.jsx"},{"name":"StatusDot","sourcePath":"components/core/StatusDot.jsx"},{"name":"Tile","sourcePath":"components/core/Tile.jsx"},{"name":"TileHeader","sourcePath":"components/core/TileHeader.jsx"},{"name":"Modal","sourcePath":"components/feedback/Modal.jsx"}],"sourceHashes":{"components/controls/Button.jsx":"c4a7efc0140c","components/controls/Chip.jsx":"4b1e266f3a0e","components/controls/ControlTap.jsx":"490948446d98","components/controls/Switch.jsx":"89356aaf7d8e","components/core/Icon.jsx":"b547cbcfe0dd","components/core/Pill.jsx":"c5327c785be7","components/core/Skeleton.jsx":"d7fb59744504","components/core/Stat.jsx":"bc02e50aa61f","components/core/StatusDot.jsx":"4f1d85bca5b2","components/core/Tile.jsx":"3c7906204db1","components/core/TileHeader.jsx":"7cefd26f572e","components/feedback/Modal.jsx":"af2d743c1df2","ui_kits/control-center/board.jsx":"3206c34571b5","ui_kits/control-center/controls.jsx":"78fa7988d60e","ui_kits/control-center/tiles.jsx":"68b4d79e7743"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {
  const __ds_ns = (window.WorldWideWebbDesignSystem_9ddf08 =
    window.WorldWideWebbDesignSystem_9ddf08 || {});

  const __ds_scope = {};

  __ds_ns.__errors = __ds_ns.__errors || [];

  // components/controls/Button.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * Button — brand button. Three variants: primary (accent fill), secondary
       * (nested surface + hairline), ghost (dashed). Two sizes. Reads the same tokens
       * as the rest of the system; no per-call styling needed.
       */
      function Button({
        variant = "secondary",
        size = "md",
        children,
        onClick,
        disabled,
        type = "button",
        style,
      }) {
        const pad = size === "sm" ? "7px 13px" : "10px 18px";
        const fontSize = size === "sm" ? 13 : 14;
        const variants = {
          primary: {
            background: "var(--acc)",
            color: "#fff",
            border: "1px solid var(--acc)",
          },
          secondary: {
            background: "var(--nest)",
            color: "var(--ink)",
            border: "1px solid var(--hair)",
          },
          ghost: {
            background: "transparent",
            color: "var(--ink-2)",
            border: "1.5px dashed var(--hair-2)",
          },
        };
        return React.createElement(
          "button",
          {
            type,
            onClick: disabled ? undefined : onClick,
            disabled,
            style: {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: pad,
              fontSize,
              fontWeight: 500,
              fontFamily: "var(--ui)",
              letterSpacing: "-0.01em",
              borderRadius: 11,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.45 : 1,
              transition: "filter 0.16s ease, border-color 0.16s ease",
              ...variants[variant],
              ...style,
            },
          },
          children,
        );
      }
      Object.assign(__ds_scope, { Button });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/controls/Button.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/controls/Chip.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * Chip — a segmented-control option. Equal-flex pill in a row; the active chip
       * fills accent-dim with blue text + border. Used for HVAC modes and similar.
       */
      function Chip({ active, onClick, children }) {
        return React.createElement(
          "button",
          {
            type: "button",
            className: `chip${active ? " on" : ""}`,
            onClick,
          },
          children,
        );
      }
      Object.assign(__ds_scope, { Chip });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/controls/Chip.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/controls/ControlTap.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * ControlTap — a large square toggle cell for the controls grid. Glyph top-left,
       * status dot top-right, label + ON/OFF bottom row. Turns accent-dim when on. Can
       * render a color swatch instead of a glyph (scenes), and the fan glyph spins.
       */
      function ControlTap({ icon, label, on, sub, pending, swatch, disabled, onToggle }) {
        const { Icon } = window.WorldWideWebbDesignSystem_9ddf08;
        const statusText = on ? (sub ?? "On") : "Off";
        const glyph = icon === "bulb" && !on ? "bulb-off" : icon;
        let topLeft;
        if (swatch) {
          topLeft = React.createElement("span", {
            "data-swatch": "",
            style: {
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: swatch,
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,.18)",
            },
          });
        } else if (icon === "fan") {
          topLeft = React.createElement(
            "span",
            {
              "data-fan-spin": "",
              style: {
                display: "inline-flex",
                animation: "spin 10s linear infinite",
                animationPlayState: on ? "running" : "paused",
              },
            },
            React.createElement(Icon, {
              name: "fan",
              s: 26,
              c: on ? "var(--acc)" : "var(--ink-2)",
            }),
          );
        } else {
          topLeft = React.createElement(Icon, {
            name: glyph,
            s: 26,
            c: on ? "var(--acc)" : "var(--ink-2)",
          });
        }
        return React.createElement(
          "button",
          {
            type: "button",
            className: `tap${on ? " on" : ""}`,
            onClick: disabled ? undefined : onToggle,
            disabled,
            "data-pending": pending ? "true" : undefined,
            "aria-pressed": on,
            "aria-label": label,
            style: {
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
            },
          },
          React.createElement(
            "div",
            {
              style: {
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              },
            },
            topLeft,
            React.createElement("span", {
              className: "sd",
            }),
          ),
          React.createElement(
            "div",
            {
              style: {
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              },
            },
            React.createElement(
              "span",
              {
                style: {
                  fontSize: 18,
                  fontWeight: 500,
                },
              },
              label,
            ),
            React.createElement(
              "span",
              {
                className: "mono",
                style: {
                  fontSize: 12,
                  color: on ? "var(--acc)" : "var(--ink-3)",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                },
              },
              statusText,
            ),
          ),
        );
      }
      Object.assign(__ds_scope, { ControlTap });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/controls/ControlTap.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/controls/Switch.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * Switch — the brand toggle. Pill track that fills accent-dim with a blue glowing
       * knob when on; the knob springs across with a slight overshoot. Controlled.
       */
      function Switch({ on, onToggle, disabled, "aria-label": ariaLabel }) {
        return React.createElement(
          "button",
          {
            type: "button",
            className: `sw${on ? " on" : ""}`,
            onClick: disabled ? undefined : onToggle,
            disabled,
            "aria-pressed": on,
            "aria-label": ariaLabel,
            style: {
              padding: 0,
              opacity: disabled ? 0.4 : 1,
            },
          },
          React.createElement("span", {
            className: "knob",
          }),
        );
      }
      Object.assign(__ds_scope, { Switch });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/controls/Switch.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/core/Icon.jsx
  try {
    (() => {
      /**
       * Icon — the single icon primitive for WorldWideWebb.
       *
       * The brand uses one icon library: Lucide, at a deliberately small curated
       * vocabulary (a fixed wall panel, not a free-for-all). Each IconName maps to one
       * Lucide glyph. House conventions live here in ONE place: 1.7 stroke width,
       * currentColor stroke, a square size scale, block layout, aria-hidden.
       *
       * Glyph geometry is read at render time from the Lucide UMD global
       * (window.lucide), so pages that render icons must include the Lucide CDN script:
       *   <script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
       * Adding an icon = add a NAME→Lucide-PascalName entry to GLYPHS below.
       */

      const React = window.React;

      // Curated set: brand IconName → Lucide PascalCase name.
      const GLYPHS = {
        sun: "Sun",
        moon: "Moon",
        cloud: "Cloud",
        "cloud-sun": "CloudSun",
        lamp: "Lamp",
        bulb: "Lightbulb",
        "bulb-off": "LightbulbOff",
        fan: "Fan",
        thermo: "Thermometer",
        car: "Car",
        bolt: "Zap",
        lock: "Lock",
        unlock: "LockOpen",
        wifi: "Wifi",
        pin: "MapPin",
        cam: "Video",
        dog: "Dog",
        calendar: "Calendar",
        plus: "Plus",
        bell: "Bell",
        chevron: "ChevronRight",
        up: "ArrowUp",
        down: "ArrowDown",
        sparkles: "Sparkles",
        globe: "Globe",
        speaker: "Volume2",
        apps: "LayoutGrid",
      };
      function Icon({ name, s = 22, c = "currentColor", sw = 1.7, style }) {
        const lucide = typeof window !== "undefined" ? window.lucide : undefined;
        const pascal = GLYPHS[name] ?? name;
        const node = lucide && lucide.icons ? lucide.icons[pascal] : undefined;
        const baseStyle = {
          display: "block",
          flex: "0 0 auto",
          ...style,
        };

        // Lucide IconNode = array of [tag, attrs] children, drawn in a 24×24 viewBox.
        const children =
          node && Array.isArray(node)
            ? node.map(([tag, attrs], i) =>
                React.createElement(tag, {
                  key: i,
                  ...attrs,
                }),
              )
            : null;
        return React.createElement(
          "svg",
          {
            width: s,
            height: s,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: c,
            strokeWidth: sw,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            style: baseStyle,
          },
          children,
        );
      }
      Object.assign(__ds_scope, { GLYPHS, Icon });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/core/Icon.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/core/Pill.jsx
  try {
    (() => {
      const React = window.React;
      const PillTone = {
        Default: "default",
        On: "on",
        Amber: "amber",
      };

      /**
       * Pill — a small rounded status capsule. Three tones: default (neutral),
       * on (accent blue, for live/active), amber (attention/unlocked).
       */
      function Pill({ tone = "default", children, style }) {
        const cls = tone === "default" ? "pill" : `pill ${tone}`;
        return React.createElement(
          "span",
          {
            className: cls,
            style,
          },
          children,
        );
      }
      Object.assign(__ds_scope, { PillTone, Pill });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/core/Pill.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/core/Skeleton.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * Skeleton — a shimmering placeholder. Tiles keep their title visible while
       * data loads and shimmer only the data regions; the QueryClient retries
       * infinitely so a tile recovers on its own. Never show invented/fallback data.
       */
      function Skeleton({ w, h = 14, borderRadius = 6 }) {
        return React.createElement("div", {
          "data-skeleton": true,
          style: {
            width: w,
            height: h,
            borderRadius,
            background:
              "linear-gradient(90deg, var(--tile-2) 25%, var(--nest) 50%, var(--tile-2) 75%)",
            backgroundSize: "200%",
            animation: "shimmer 1.6s linear infinite",
          },
        });
      }
      Object.assign(__ds_scope, { Skeleton });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/core/Skeleton.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/core/Stat.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * Stat — a labeled telemetry value. Uppercase tracked caption over a big mono
       * number. accent paints the value blue; muted paints it gray; sub adds a small
       * tertiary line below.
       */
      function Stat({ label, value, accent, muted, sub }) {
        return React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 2,
            },
          },
          React.createElement(
            "span",
            {
              className: "cap",
            },
            label,
          ),
          React.createElement(
            "span",
            {
              "data-stat-value": true,
              className: "mono",
              style: {
                fontSize: 22,
                fontWeight: 700,
                color: accent ? "var(--acc)" : muted ? "var(--ink-2)" : undefined,
              },
            },
            value,
          ),
          sub
            ? React.createElement(
                "span",
                {
                  style: {
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                  },
                },
                sub,
              )
            : null,
        );
      }
      Object.assign(__ds_scope, { Stat });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/core/Stat.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/core/StatusDot.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * StatusDot — an 8px presence indicator. online renders a pulsing accent dot;
       * otherwise a static muted dot. Used in tile headers for connectivity.
       */
      function StatusDot({ online }) {
        if (online)
          return React.createElement("span", {
            className: "dot",
          });
        return React.createElement("span", {
          style: {
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--ink-3)",
            display: "inline-block",
          },
        });
      }
      Object.assign(__ds_scope, { StatusDot });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/core/StatusDot.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/core/Tile.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * Tile — the foundational card surface. Pure neutral #0a0a0a, 1px hairline
       * border, 20px radius, inset top highlight + soft drop shadow. Border brightens
       * on hover. Everything on the board lives inside a Tile.
       */
      function Tile({ padding, children, className, style, onClick }) {
        return React.createElement(
          "div",
          {
            className: `tile${className ? ` ${className}` : ""}`,
            onClick,
            style: {
              height: "100%",
              padding,
              display: "flex",
              flexDirection: "column",
              ...style,
            },
          },
          children,
        );
      }
      Object.assign(__ds_scope, { Tile });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/core/Tile.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/core/TileHeader.jsx
  try {
    (() => {
      const React = window.React;

      /**
       * TileHeader — the standard top row of a tile: a muted icon, a tight semibold
       * title, and an optional right-aligned slot (pill, status dot, caption).
       */
      function TileHeader({ icon, title, right, iconSize = 19, titleSize = 17.5 }) {
        const { Icon } = window.WorldWideWebbDesignSystem_9ddf08;
        return React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 16,
            },
          },
          React.createElement(Icon, {
            name: icon,
            s: iconSize,
            c: "var(--ink-2)",
          }),
          React.createElement(
            "span",
            {
              style: {
                fontSize: titleSize,
                fontWeight: 600,
                letterSpacing: "-0.015em",
              },
            },
            title,
          ),
          right
            ? React.createElement(
                "div",
                {
                  style: {
                    marginLeft: "auto",
                  },
                },
                right,
              )
            : null,
        );
      }
      Object.assign(__ds_scope, { TileHeader });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/core/TileHeader.jsx",
      error: String((e && e.message) || e),
    });
  }

  // components/feedback/Modal.jsx
  try {
    (() => {
      const React = window.React;
      const { useEffect } = React;
      const ReactDOM = window.ReactDOM;

      /**
       * Modal — a dumb presentational overlay + centered fixed-size panel. Dim
       * backdrop (rgba black .55), tile-surface panel with the entrance pop (rises +
       * scales from slightly below). Header with title + a square × close well.
       * Escape and the backdrop both close. Portals to <body>.
       */
      function Modal({ open, onClose, title, children, width = 640, maxHeight = 720 }) {
        const panelWidth = Math.min(width, 1280);
        const panelMaxHeight = Math.min(maxHeight, 960);
        useEffect(() => {
          if (!open) return;
          function onKeyDown(e) {
            if (e.key === "Escape") onClose();
          }
          window.addEventListener("keydown", onKeyDown);
          return () => window.removeEventListener("keydown", onKeyDown);
        }, [open, onClose]);
        if (!open) return null;
        const tree = React.createElement(
          "div",
          {
            style: {
              position: "fixed",
              inset: 0,
              zIndex: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
          },
          React.createElement("button", {
            type: "button",
            "aria-hidden": "true",
            tabIndex: -1,
            className: "modal-backdrop",
            onClick: onClose,
            style: {
              position: "absolute",
              inset: 0,
              border: "none",
              padding: 0,
              cursor: "default",
              background: "rgba(0, 0, 0, 0.55)",
              animation: "modalBackdropIn 180ms ease-out",
            },
          }),
          React.createElement(
            "div",
            {
              role: "dialog",
              "aria-modal": "true",
              className: "modal-panel",
              style: {
                position: "relative",
                width: panelWidth,
                maxHeight: panelMaxHeight,
                display: "flex",
                flexDirection: "column",
                background: "var(--tile)",
                color: "var(--ink)",
                border: "1px solid var(--hair)",
                borderRadius: "var(--r)",
                boxShadow: "var(--shadow-modal)",
                fontFamily: "var(--ui)",
                overflow: "hidden",
                transformOrigin: "center",
                animation: "modalPanelIn 220ms cubic-bezier(0.16,1,0.3,1)",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 20,
                },
              },
              React.createElement(
                "h2",
                {
                  style: {
                    margin: 0,
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--ink)",
                  },
                },
                title,
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  "aria-label": "Close",
                  onClick: onClose,
                  style: {
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
                  },
                },
                React.createElement(
                  "span",
                  {
                    "aria-hidden": "true",
                  },
                  "\u00d7",
                ),
              ),
            ),
            React.createElement(
              "div",
              {
                className: "modal-scroll",
                style: {
                  padding: 20,
                  overflowY: "auto",
                  flex: 1,
                },
              },
              children,
            ),
          ),
        );
        return ReactDOM.createPortal(tree, document.body);
      }
      Object.assign(__ds_scope, { Modal });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "components/feedback/Modal.jsx",
      error: String((e && e.message) || e),
    });
  }

  // ui_kits/control-center/board.jsx
  try {
    (() => {
      // Control Center UI kit — the board. Lays the bento of tiles on the void and
      // wires the shared controls state + the expanded controls modal.
      const React = window.React;
      const { useState } = React;

      // [component, gridColumn, gridRow]
      const LAYOUT = [
        ["TvNowPlayingTile", "1 / 7", "1 / 4"],
        ["SoundSystemTile", "7 / 13", "1 / 4"],
        ["ClockTile", "1 / 6", "4 / 7"],
        ["WeatherTile", "6 / 10", "4 / 7"],
        ["NetworkTile", "10 / 13", "4 / 7"],
        ["TeslaTile", "1 / 6", "7 / 11"],
        ["HourlyTile", "6 / 10", "7 / 10"],
        ["__CONTROLS__", "10 / 13", "7 / 10"],
        ["DogCamTile", "6 / 10", "10 / 13"],
        ["ClimateTile", "10 / 13", "10 / 13"],
        ["EventsTile", "1 / 6", "11 / 13"],
      ];
      function Board() {
        const [data, setData] = useState({
          lamps: true,
          lights: false,
          fan: true,
        });
        const [modalOpen, setModalOpen] = useState(false);
        const onToggle = (k) =>
          setData((d) => ({
            ...d,
            [k]: !d[k],
          }));
        const { ControlsTile, ControlsModal } = window;
        return /*#__PURE__*/ React.createElement(
          "div",
          {
            style: {
              position: "relative",
            },
          },
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                width: 1366,
                padding: 18,
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gridTemplateRows: "repeat(12, 96px)",
                gap: 18,
                background: "var(--bg)",
              },
            },
            LAYOUT.map(([name, col, row]) => {
              const Comp = name === "__CONTROLS__" ? null : window[name];
              return /*#__PURE__*/ React.createElement(
                "div",
                {
                  key: name,
                  style: {
                    gridColumn: col,
                    gridRow: row,
                    minHeight: 0,
                  },
                },
                name === "__CONTROLS__"
                  ? /*#__PURE__*/ React.createElement(ControlsTile, {
                      data: data,
                      onToggle: onToggle,
                      onMore: () => setModalOpen(true),
                    })
                  : /*#__PURE__*/ React.createElement(Comp, null),
              );
            }),
          ),
          /*#__PURE__*/ React.createElement(ControlsModal, {
            open: modalOpen,
            onClose: () => setModalOpen(false),
            data: data,
            onToggle: onToggle,
          }),
        );
      }
      window.CCBoard = Board;
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "ui_kits/control-center/board.jsx",
      error: String((e && e.message) || e),
    });
  }

  // ui_kits/control-center/controls.jsx
  try {
    (() => {
      // Control Center UI kit — Controls tile + expanded modal, and media tiles.
      const React = window.React;
      const { useState } = React;
      const DS = window.WorldWideWebbDesignSystem_9ddf08;
      const { Tile, TileHeader, Pill, Icon, ControlTap, Chip, Switch, Modal, Button } = DS;

      // ─── Controls tile (2×2 tap grid + more) ──────────────────────────────────────
      function ControlsTile({ data, onToggle, onMore }) {
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 20,
            onClick: (e) => {
              if (!e.target.closest(".tap")) onMore();
            },
            style: {
              cursor: "pointer",
            },
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "bulb",
            title: "Controls",
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                minHeight: 0,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gridTemplateRows: "1fr 1fr",
                gap: 13,
              },
            },
            /*#__PURE__*/ React.createElement(ControlTap, {
              icon: "lamp",
              label: "Lamps",
              on: data.lamps,
              sub: "3 on",
              onToggle: () => onToggle("lamps"),
            }),
            /*#__PURE__*/ React.createElement(ControlTap, {
              icon: "bulb",
              label: "Lights",
              on: data.lights,
              onToggle: () => onToggle("lights"),
            }),
            /*#__PURE__*/ React.createElement(ControlTap, {
              icon: "fan",
              label: "Fan",
              on: data.fan,
              sub: "Med",
              onToggle: () => onToggle("fan"),
            }),
            /*#__PURE__*/ React.createElement(
              "button",
              {
                type: "button",
                onClick: onMore,
                style: {
                  borderRadius: 15,
                  border: "1.5px dashed var(--hair-2)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  font: "inherit",
                  background: "none",
                },
                "aria-label": "More",
              },
              /*#__PURE__*/ React.createElement(Icon, {
                name: "chevron",
                s: 22,
                c: "var(--ink-3)",
              }),
              /*#__PURE__*/ React.createElement(
                "span",
                {
                  style: {
                    fontSize: 13,
                  },
                },
                "more",
              ),
            ),
          ),
        );
      }

      // ─── Expanded controls modal ───────────────────────────────────────────────────
      const SCENES = [
        {
          id: "white",
          label: "Warm White",
          swatch: "#f3e9d2",
        },
        {
          id: "mood",
          label: "Mood",
          swatch: "#7d4bd6",
        },
        {
          id: "red",
          label: "Sunset",
          swatch: "#e0552b",
        },
        {
          id: "blue",
          label: "Focus",
          swatch: "#0070f3",
        },
      ];
      function ControlsModal({ open, onClose, data, onToggle }) {
        const [brightness, setBrightness] = useState(72);
        const [scene, setScene] = useState("white");
        const [party, setParty] = useState(false);
        return /*#__PURE__*/ React.createElement(
          Modal,
          {
            open: open,
            onClose: onClose,
            title: "Controls",
            width: 680,
            maxHeight: 760,
          },
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: 22,
              },
            },
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 13,
                  height: 110,
                },
              },
              /*#__PURE__*/ React.createElement(ControlTap, {
                icon: "lamp",
                label: "Lamps",
                on: data.lamps,
                sub: "3 on",
                onToggle: () => onToggle("lamps"),
              }),
              /*#__PURE__*/ React.createElement(ControlTap, {
                icon: "bulb",
                label: "Lights",
                on: data.lights,
                onToggle: () => onToggle("lights"),
              }),
              /*#__PURE__*/ React.createElement(ControlTap, {
                icon: "fan",
                label: "Fan",
                on: data.fan,
                sub: "Med",
                onToggle: () => onToggle("fan"),
              }),
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              null,
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "cap",
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  },
                },
                /*#__PURE__*/ React.createElement("span", null, "Lamp Brightness"),
                /*#__PURE__*/ React.createElement(
                  "span",
                  {
                    className: "mono",
                    style: {
                      color: "var(--acc)",
                    },
                  },
                  brightness,
                  "%",
                ),
              ),
              /*#__PURE__*/ React.createElement("input", {
                className: "range range-lg",
                type: "range",
                min: "0",
                max: "100",
                value: brightness,
                style: {
                  "--p": `${brightness}%`,
                  height: 16,
                },
                onChange: (e) => setBrightness(parseInt(e.target.value, 10)),
                "aria-label": "Brightness",
              }),
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              null,
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "cap",
                  style: {
                    marginBottom: 12,
                  },
                },
                "Scenes",
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 11,
                    height: 94,
                  },
                },
                SCENES.map((s) =>
                  /*#__PURE__*/ React.createElement(
                    "button",
                    {
                      key: s.id,
                      type: "button",
                      onClick: () => setScene(s.id),
                      className: `tap${scene === s.id ? " on" : ""}`,
                      style: {
                        padding: "16px 14px 12px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        textAlign: "left",
                        font: "inherit",
                        color: "inherit",
                        cursor: "pointer",
                      },
                    },
                    /*#__PURE__*/ React.createElement("span", {
                      style: {
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: s.swatch,
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.18)",
                      },
                    }),
                    /*#__PURE__*/ React.createElement(
                      "span",
                      {
                        style: {
                          fontSize: 14,
                          fontWeight: 500,
                        },
                      },
                      s.label,
                    ),
                  ),
                ),
              ),
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  background: party ? "var(--acc-dim)" : "var(--tile-2)",
                  border: `1px solid ${party ? "var(--acc-line)" : "var(--hair)"}`,
                  borderRadius: 15,
                },
              },
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  },
                },
                /*#__PURE__*/ React.createElement(Icon, {
                  name: "sparkles",
                  s: 22,
                  c: party ? "var(--acc)" : "var(--ink-2)",
                }),
                /*#__PURE__*/ React.createElement(
                  "div",
                  null,
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      style: {
                        fontSize: 16,
                        fontWeight: 500,
                      },
                    },
                    "Party Mode",
                  ),
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      style: {
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                      },
                    },
                    "Cycle the palette to the beat",
                  ),
                ),
              ),
              /*#__PURE__*/ React.createElement(Switch, {
                on: party,
                onToggle: () => setParty((v) => !v),
                "aria-label": "Party mode",
              }),
            ),
          ),
        );
      }

      // ─── TV Now Playing ────────────────────────────────────────────────────────────
      function TvNowPlayingTile() {
        const [playing, setPlaying] = useState(true);
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "apps",
            title: "TV",
            right: /*#__PURE__*/ React.createElement(
              "span",
              {
                className: "cap",
              },
              "Apple TV",
            ),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                display: "flex",
                gap: 16,
                alignItems: "center",
              },
            },
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  width: 96,
                  height: 96,
                  borderRadius: 12,
                  background: "linear-gradient(135deg,#1a2740,#0a0a0a)",
                  border: "1px solid var(--hair)",
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                },
              },
              /*#__PURE__*/ React.createElement(Icon, {
                name: "apps",
                s: 34,
                c: "var(--ink-3)",
              }),
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  minWidth: 0,
                },
              },
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    fontSize: 18,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  },
                },
                "Severance",
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    fontSize: 13.5,
                    color: "var(--ink-2)",
                    marginTop: 3,
                  },
                },
                "S2 \xB7 E7 \xB7 \u201CChikhai Bardo\u201D",
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    marginTop: 12,
                    height: 6,
                    borderRadius: 3,
                    background: "var(--nest)",
                  },
                },
                /*#__PURE__*/ React.createElement("div", {
                  style: {
                    width: "38%",
                    height: "100%",
                    borderRadius: 3,
                    background: "var(--acc)",
                  },
                }),
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "mono",
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    marginTop: 6,
                  },
                },
                /*#__PURE__*/ React.createElement("span", null, "18:42"),
                /*#__PURE__*/ React.createElement("span", null, "-30:11"),
              ),
            ),
          ),
        );
      }

      // ─── Sound System ───────────────────────────────────────────────────────────────
      const ROOMS = [
        ["Living Room", 42, true],
        ["Kitchen", 18, true],
        ["Bedroom", 0, false],
      ];
      function SoundSystemTile() {
        const [rooms, setRooms] = useState(ROOMS);
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "speaker",
            title: "Sound System",
            right: /*#__PURE__*/ React.createElement(
              "span",
              {
                className: "pill on",
                style: {
                  padding: "3px 9px",
                },
              },
              "Sonos",
            ),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                justifyContent: "center",
              },
            },
            rooms.map(([name, vol, on], i) =>
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  key: name,
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  },
                },
                /*#__PURE__*/ React.createElement(
                  "span",
                  {
                    style: {
                      fontSize: 13.5,
                      color: on ? "var(--ink)" : "var(--ink-3)",
                      width: 96,
                      flex: "0 0 auto",
                    },
                  },
                  name,
                ),
                /*#__PURE__*/ React.createElement("input", {
                  className: "range",
                  type: "range",
                  min: "0",
                  max: "100",
                  value: vol,
                  style: {
                    "--p": `${vol}%`,
                    flex: 1,
                    height: 6,
                    opacity: on ? 1 : 0.4,
                  },
                  onChange: (e) => {
                    const v = parseInt(e.target.value, 10);
                    setRooms((r) => r.map((x, j) => (j === i ? [x[0], v, v > 0] : x)));
                  },
                  "aria-label": `${name} volume`,
                }),
                /*#__PURE__*/ React.createElement(
                  "span",
                  {
                    className: "mono",
                    style: {
                      fontSize: 12,
                      color: "var(--ink-2)",
                      width: 28,
                      textAlign: "right",
                    },
                  },
                  vol,
                ),
              ),
            ),
          ),
        );
      }
      Object.assign(window, {
        ControlsTile,
        ControlsModal,
        TvNowPlayingTile,
        SoundSystemTile,
      });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "ui_kits/control-center/controls.jsx",
      error: String((e && e.message) || e),
    });
  }

  // ui_kits/control-center/tiles.jsx
  try {
    (() => {
      // WorldWideWebb — Control Center UI kit: the dashboard tiles.
      // Each tile composes the design-system primitives. Data is realistic but static
      // (a recreation, not a live board). Exported to window for board.jsx to consume.

      const React = window.React;
      const { useState } = React;
      const DS = window.WorldWideWebbDesignSystem_9ddf08;
      const { Tile, TileHeader, Pill, Stat, StatusDot, Skeleton, Icon, ControlTap, Chip, Switch } =
        DS;

      // ─── Clock (hero) ─────────────────────────────────────────────────────────────
      function ClockTile() {
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 28,
            style: {
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              textAlign: "center",
            },
          },
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "cap acc",
              style: {
                fontSize: 14,
                letterSpacing: ".2em",
              },
            },
            "GOOD EVENING",
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "mono",
              style: {
                fontSize: 96,
                fontWeight: 700,
                letterSpacing: "-.05em",
                lineHeight: 0.82,
              },
            },
            "9:24",
            /*#__PURE__*/ React.createElement(
              "span",
              {
                style: {
                  fontSize: 26,
                  color: "var(--ink-2)",
                  marginLeft: 8,
                  letterSpacing: "0.02em",
                },
              },
              "PM",
            ),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                fontSize: 18,
                color: "var(--ink-2)",
              },
            },
            "Saturday, June 14",
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--ink-2)",
                fontSize: 14.5,
              },
            },
            /*#__PURE__*/ React.createElement(Icon, {
              name: "pin",
              s: 15,
              c: "var(--ink-3)",
            }),
            " San Francisco, CA",
          ),
        );
      }

      // ─── Weather ──────────────────────────────────────────────────────────────────
      function MetricCell({ label, value }) {
        return /*#__PURE__*/ React.createElement(
          "div",
          null,
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "cap",
              style: {
                fontSize: 10,
              },
            },
            label,
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "mono",
              style: {
                fontSize: 16,
                marginTop: 4,
              },
            },
            value,
          ),
        );
      }
      function WeatherTile() {
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "cloud-sun",
            title: "Weather Now",
            right: /*#__PURE__*/ React.createElement(
              "span",
              {
                className: "cap",
              },
              "San Francisco",
            ),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 20,
              },
            },
            /*#__PURE__*/ React.createElement(Icon, {
              name: "cloud-sun",
              s: 76,
              c: "var(--ink)",
              sw: 1.3,
            }),
            /*#__PURE__*/ React.createElement(
              "div",
              null,
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  className: "mono",
                  style: {
                    fontSize: 66,
                    fontWeight: 700,
                    lineHeight: 0.8,
                    letterSpacing: "-0.04em",
                  },
                },
                "62\xB0",
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    fontSize: 16,
                    color: "var(--ink-2)",
                    marginTop: 9,
                  },
                },
                "Partly Cloudy",
              ),
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "mono",
                style: {
                  marginLeft: "auto",
                  textAlign: "right",
                  lineHeight: 1.55,
                },
              },
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    fontSize: 15,
                  },
                },
                "H 67\xB0",
              ),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    fontSize: 15,
                    color: "var(--ink-2)",
                  },
                },
                "L 54\xB0",
              ),
            ),
          ),
          /*#__PURE__*/ React.createElement("div", {
            className: "divider",
            style: {
              margin: "4px 0 14px",
            },
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: 10,
              },
            },
            /*#__PURE__*/ React.createElement(MetricCell, {
              label: "Feels",
              value: "60\xB0",
            }),
            /*#__PURE__*/ React.createElement(MetricCell, {
              label: "Humidity",
              value: "71%",
            }),
            /*#__PURE__*/ React.createElement(MetricCell, {
              label: "Wind",
              value: "9 mph",
            }),
            /*#__PURE__*/ React.createElement(MetricCell, {
              label: "Sunset",
              value: "8:31",
            }),
          ),
        );
      }

      // ─── Network ──────────────────────────────────────────────────────────────────
      const TRAFFIC = [
        6, 10, 8, 14, 9, 18, 12, 22, 16, 11, 9, 13, 20, 15, 26, 19, 30, 24, 17, 28, 21, 34, 40, 27,
      ];
      function ButterflyChart() {
        const half = 50,
          dMax = 44,
          uMax = 28;
        return /*#__PURE__*/ React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 2,
              height: half * 2,
            },
          },
          TRAFFIC.map((d, i) =>
            /*#__PURE__*/ React.createElement(
              "div",
              {
                key: i,
                style: {
                  flex: 1,
                  position: "relative",
                  height: "100%",
                },
              },
              /*#__PURE__*/ React.createElement("div", {
                style: {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: "50%",
                  height: (d / dMax) * half,
                  background: "var(--acc)",
                  borderRadius: "2px 2px 0 0",
                  opacity: i > 17 ? 1 : 0.82,
                },
              }),
              /*#__PURE__*/ React.createElement("div", {
                style: {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "50%",
                  height: ((d * 0.6) / uMax) * half,
                  background: "var(--acc-muted)",
                  borderRadius: "0 0 2px 2px",
                },
              }),
            ),
          ),
        );
      }
      function NetworkTile() {
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "wifi",
            title: "Network",
            right: /*#__PURE__*/ React.createElement(StatusDot, {
              online: true,
            }),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              },
            },
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "mono",
                style: {
                  fontSize: 12.5,
                  color: "var(--acc)",
                  marginBottom: 5,
                },
              },
              "\u2193 42.8 GB",
            ),
            /*#__PURE__*/ React.createElement(ButterflyChart, null),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                className: "mono",
                style: {
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  marginTop: 5,
                },
              },
              "\u2191 8.1 GB",
            ),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "cap",
              style: {
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
              },
            },
            /*#__PURE__*/ React.createElement("span", null, "Webb-5G"),
            /*#__PURE__*/ React.createElement("span", null, "8ms"),
          ),
        );
      }

      // ─── Tesla ────────────────────────────────────────────────────────────────────
      function TeslaMap() {
        return /*#__PURE__*/ React.createElement(
          "div",
          {
            className: "feed",
            style: {
              width: "100%",
              height: "100%",
              minHeight: 130,
              background: "radial-gradient(120% 120% at 70% 30%, #0d0d0d, #060606)",
            },
          },
          /*#__PURE__*/ React.createElement("div", {
            style: {
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(var(--hair) 1px, transparent 1px), linear-gradient(90deg, var(--hair) 1px, transparent 1px)",
              backgroundSize: "34px 34px",
              opacity: 0.5,
            },
          }),
          /*#__PURE__*/ React.createElement("div", {
            style: {
              position: "absolute",
              left: "32%",
              top: "44%",
              width: 110,
              height: 4,
              background: "var(--acc-muted)",
              borderRadius: 2,
              transform: "rotate(28deg)",
            },
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                position: "absolute",
                left: "58%",
                top: "55%",
                transform: "translate(-50%,-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              },
            },
            /*#__PURE__*/ React.createElement("span", {
              className: "dot",
            }),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                position: "absolute",
                left: 12,
                bottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                color: "var(--ink-2)",
              },
            },
            /*#__PURE__*/ React.createElement(Icon, {
              name: "pin",
              s: 13,
              c: "var(--acc)",
            }),
            " Home \xB7 Garage",
          ),
        );
      }
      function TeslaTile() {
        const [locked, setLocked] = useState(true);
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
            style: {
              gap: 16,
            },
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "car",
            title: "Tesla",
            right: /*#__PURE__*/ React.createElement(
              "button",
              {
                type: "button",
                onClick: () => setLocked((v) => !v),
                style: {
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                },
              },
              /*#__PURE__*/ React.createElement(
                "span",
                {
                  className: `pill${locked ? "" : " amber"}`,
                },
                /*#__PURE__*/ React.createElement(Icon, {
                  name: locked ? "lock" : "unlock",
                  s: 15,
                }),
                locked ? "Locked" : "Unlocked",
              ),
            ),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                minHeight: 130,
              },
            },
            /*#__PURE__*/ React.createElement(TeslaMap, null),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            null,
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  marginBottom: 9,
                },
              },
              /*#__PURE__*/ React.createElement(
                "span",
                {
                  className: "pill on",
                  style: {
                    padding: "4px 10px",
                  },
                },
                /*#__PURE__*/ React.createElement(Icon, {
                  name: "bolt",
                  s: 14,
                }),
                " Charging \xB7 +31 mi/hr",
              ),
              /*#__PURE__*/ React.createElement(
                "span",
                {
                  className: "mono",
                  style: {
                    fontSize: 17,
                    fontWeight: 700,
                  },
                },
                "74%",
              ),
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  height: 12,
                  borderRadius: 7,
                  background: "var(--nest)",
                  overflow: "hidden",
                  border: "1px solid var(--hair)",
                },
              },
              /*#__PURE__*/ React.createElement("div", {
                style: {
                  width: "74%",
                  height: "100%",
                  background: "linear-gradient(90deg,var(--acc-2),var(--acc))",
                  borderRadius: 7,
                  boxShadow: "0 0 14px var(--acc-line)",
                },
              }),
            ),
          ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                paddingTop: 2,
              },
            },
            /*#__PURE__*/ React.createElement(Stat, {
              label: "Range",
              value: "248 mi",
              accent: true,
            }),
            /*#__PURE__*/ React.createElement(Stat, {
              label: "Odometer",
              value: "18,204",
            }),
            /*#__PURE__*/ React.createElement(Stat, {
              label: "Cabin",
              value: "68\xB0F",
            }),
          ),
        );
      }

      // ─── Next 12 Hours ────────────────────────────────────────────────────────────
      const HOURS = [
        ["9 PM", "moon", 60],
        ["10 PM", "moon", 58],
        ["11 PM", "cloud", 56],
        ["12 AM", "cloud", 55],
        ["1 AM", "cloud", 54],
        ["2 AM", "moon", 53],
      ];
      function HourlyTile() {
        const temps = HOURS.map((h) => h[2]);
        const min = Math.min(...temps),
          max = Math.max(...temps);
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "moon",
            title: "Next 12 Hours",
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                display: "flex",
                alignItems: "stretch",
                gap: 4,
              },
            },
            HOURS.map(([t, ic, temp], i) =>
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  key: i,
                  style: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 4,
                  },
                },
                /*#__PURE__*/ React.createElement(
                  "span",
                  {
                    className: "cap",
                    style: {
                      fontSize: 9.5,
                    },
                  },
                  t,
                ),
                /*#__PURE__*/ React.createElement(Icon, {
                  name: ic,
                  s: 20,
                  c: "var(--ink-2)",
                }),
                /*#__PURE__*/ React.createElement(
                  "div",
                  {
                    style: {
                      flex: 1,
                      display: "flex",
                      alignItems: "flex-end",
                      width: "100%",
                      justifyContent: "center",
                    },
                  },
                  /*#__PURE__*/ React.createElement("div", {
                    style: {
                      width: 6,
                      borderRadius: 3,
                      height: `${20 + ((temp - min) / (max - min + 0.001)) * 60}%`,
                      background: i === 0 ? "var(--acc)" : "var(--acc-muted)",
                    },
                  }),
                ),
                /*#__PURE__*/ React.createElement(
                  "span",
                  {
                    className: "mono",
                    style: {
                      fontSize: 13,
                      marginTop: 6,
                    },
                  },
                  temp,
                  "\xB0",
                ),
              ),
            ),
          ),
        );
      }

      // ─── Dog Cam ──────────────────────────────────────────────────────────────────
      function DogCamTile() {
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "dog",
            title: "Dog Cam",
            right: /*#__PURE__*/ React.createElement(
              "span",
              {
                className: "pill on",
                style: {
                  padding: "3px 9px",
                },
              },
              /*#__PURE__*/ React.createElement("span", {
                className: "dot",
                style: {
                  width: 6,
                  height: 6,
                },
              }),
              " LIVE",
            ),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              className: "feed",
              style: {
                flex: 1,
                minHeight: 120,
                background: "radial-gradient(130% 100% at 40% 20%, #161310, #070707)",
                display: "grid",
                placeItems: "center",
              },
            },
            /*#__PURE__*/ React.createElement("div", {
              className: "scan",
            }),
            /*#__PURE__*/ React.createElement(Icon, {
              name: "dog",
              s: 60,
              c: "rgba(255,255,255,0.10)",
              sw: 1.2,
            }),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  position: "absolute",
                  left: 12,
                  top: 10,
                  fontSize: 11,
                  color: "var(--ink-2)",
                  fontFamily: "var(--mono)",
                },
              },
              "CAM 01 \xB7 LIVING ROOM",
            ),
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  position: "absolute",
                  right: 12,
                  bottom: 10,
                  fontSize: 11,
                  color: "var(--ink-2)",
                  fontFamily: "var(--mono)",
                },
              },
              "21:24:08",
            ),
          ),
        );
      }

      // ─── Climate ──────────────────────────────────────────────────────────────────
      function ClimateTile() {
        const [mode, setMode] = useState("cool");
        const [target, setTarget] = useState(72);
        const modes = [
          ["cool", "Cool"],
          ["heat", "Heat"],
          ["heat_cool", "Heat·Cool"],
          ["off", "Off"],
        ];
        const ambient = 71,
          vMin = 67,
          vMax = 77;
        const pct = (v) => ((v - vMin) / (vMax - vMin)) * 100;
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "thermo",
            title: "Climate \xB7 A/C",
            right: /*#__PURE__*/ React.createElement(
              "span",
              {
                className: "pill on",
                style: {
                  padding: "4px 10px",
                },
              },
              mode === "off" ? "Idle" : "Cooling",
            ),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              },
            },
            mode === "off"
              ? /*#__PURE__*/ React.createElement(
                  "div",
                  {
                    style: {
                      fontSize: 52,
                      fontWeight: 700,
                      color: "var(--ink-3)",
                      letterSpacing: "-0.02em",
                    },
                  },
                  "Off",
                )
              : /*#__PURE__*/ React.createElement(
                  "div",
                  {
                    className: "mono",
                    style: {
                      fontSize: 92,
                      fontWeight: 700,
                      lineHeight: 0.9,
                      letterSpacing: "-0.04em",
                    },
                  },
                  target,
                  /*#__PURE__*/ React.createElement(
                    "span",
                    {
                      style: {
                        fontSize: 30,
                        color: "var(--ink-2)",
                      },
                    },
                    "\xB0F",
                  ),
                ),
          ),
          mode !== "off" &&
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  position: "relative",
                  paddingBottom: 28,
                  marginBottom: 18,
                },
              },
              /*#__PURE__*/ React.createElement("input", {
                className: "range",
                type: "range",
                min: vMin,
                max: vMax,
                value: target,
                style: {
                  "--p": `${pct(target)}%`,
                },
                onChange: (e) => setTarget(parseInt(e.target.value, 10)),
                "aria-label": "Target temperature",
              }),
              /*#__PURE__*/ React.createElement(
                "div",
                {
                  style: {
                    position: "absolute",
                    left: `${pct(ambient)}%`,
                    top: -3,
                    transform: "translateX(-50%)",
                    pointerEvents: "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  },
                },
                /*#__PURE__*/ React.createElement("div", {
                  style: {
                    width: 2,
                    height: 22,
                    background: "rgba(255,255,255,.65)",
                    borderRadius: 1,
                  },
                }),
                /*#__PURE__*/ React.createElement(
                  "span",
                  {
                    className: "mono",
                    style: {
                      fontSize: 11,
                      color: "var(--ink-2)",
                      marginTop: 3,
                    },
                  },
                  ambient,
                  "\xB0",
                ),
              ),
              /*#__PURE__*/ React.createElement(
                "span",
                {
                  className: "mono",
                  style: {
                    position: "absolute",
                    left: 0,
                    bottom: 0,
                    fontSize: 12,
                    color: "var(--ink-3)",
                  },
                },
                vMin,
                "\xB0",
              ),
              /*#__PURE__*/ React.createElement(
                "span",
                {
                  className: "mono",
                  style: {
                    position: "absolute",
                    right: 0,
                    bottom: 0,
                    fontSize: 12,
                    color: "var(--ink-3)",
                  },
                },
                vMax,
                "\xB0",
              ),
            ),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                display: "flex",
                gap: 8,
              },
            },
            modes.map(([k, label]) =>
              /*#__PURE__*/ React.createElement(
                Chip,
                {
                  key: k,
                  active: mode === k,
                  onClick: () => setMode(k),
                },
                label,
              ),
            ),
          ),
        );
      }

      // ─── Events ───────────────────────────────────────────────────────────────────
      const EVENTS = [
        {
          name: "Dentist",
          place: "Dr. Lee · Mission",
          days: 2,
        },
        {
          name: "Mom's Birthday",
          place: "Sausalito",
          days: 5,
        },
        {
          name: "SF → NYC",
          place: "SFO · United",
          days: 12,
        },
      ];
      function EventsTile() {
        return /*#__PURE__*/ React.createElement(
          Tile,
          {
            padding: 22,
          },
          /*#__PURE__*/ React.createElement(TileHeader, {
            icon: "calendar",
            title: "Upcoming",
            right: /*#__PURE__*/ React.createElement(
              "span",
              {
                className: "cap",
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                },
              },
              "All ",
              /*#__PURE__*/ React.createElement(Icon, {
                name: "chevron",
                s: 12,
                c: "var(--ink-3)",
              }),
            ),
          }),
          /*#__PURE__*/ React.createElement(
            "div",
            {
              style: {
                flex: 1,
                display: "flex",
                alignItems: "center",
              },
            },
            /*#__PURE__*/ React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "stretch",
                  width: "100%",
                },
              },
              EVENTS.map((e, i) =>
                /*#__PURE__*/ React.createElement(
                  "div",
                  {
                    key: i,
                    style: {
                      flex: 1,
                      minWidth: 0,
                      paddingLeft: i === 0 ? 0 : 22,
                      paddingRight: 14,
                      borderLeft: i === 0 ? "none" : "1px solid var(--hair)",
                    },
                  },
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      style: {
                        display: "flex",
                        alignItems: "baseline",
                        gap: 5,
                        marginBottom: 9,
                      },
                    },
                    /*#__PURE__*/ React.createElement(
                      "span",
                      {
                        className: "mono",
                        style: {
                          fontSize: 32,
                          fontWeight: 700,
                          lineHeight: 0.82,
                          color: e.days <= 3 ? "var(--acc)" : "var(--ink)",
                        },
                      },
                      e.days,
                    ),
                    /*#__PURE__*/ React.createElement(
                      "span",
                      {
                        className: "cap",
                        style: {
                          fontSize: 11,
                        },
                      },
                      "days",
                    ),
                  ),
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      style: {
                        fontSize: 16,
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      },
                    },
                    e.name,
                  ),
                  /*#__PURE__*/ React.createElement(
                    "div",
                    {
                      style: {
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        marginTop: 2,
                      },
                    },
                    e.place,
                  ),
                ),
              ),
            ),
          ),
        );
      }
      Object.assign(window, {
        ClockTile,
        WeatherTile,
        NetworkTile,
        TeslaTile,
        HourlyTile,
        DogCamTile,
        ClimateTile,
        EventsTile,
      });
    })();
  } catch (e) {
    __ds_ns.__errors.push({
      path: "ui_kits/control-center/tiles.jsx",
      error: String((e && e.message) || e),
    });
  }

  __ds_ns.Button = __ds_scope.Button;

  __ds_ns.Chip = __ds_scope.Chip;

  __ds_ns.ControlTap = __ds_scope.ControlTap;

  __ds_ns.Switch = __ds_scope.Switch;

  __ds_ns.GLYPHS = __ds_scope.GLYPHS;

  __ds_ns.Icon = __ds_scope.Icon;

  __ds_ns.PillTone = __ds_scope.PillTone;

  __ds_ns.Pill = __ds_scope.Pill;

  __ds_ns.Skeleton = __ds_scope.Skeleton;

  __ds_ns.Stat = __ds_scope.Stat;

  __ds_ns.StatusDot = __ds_scope.StatusDot;

  __ds_ns.Tile = __ds_scope.Tile;

  __ds_ns.TileHeader = __ds_scope.TileHeader;

  __ds_ns.Modal = __ds_scope.Modal;
})();
