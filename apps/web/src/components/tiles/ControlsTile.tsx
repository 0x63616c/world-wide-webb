/**
 * Controls tile — lamps, ceiling lights, fan + "More" placeholder.
 * Ported from the ETap / ctrl cell in evee-tiles.jsx / Evee Dashboard.html.
 *
 * Data: trpc.controls.list (refetch 30s).
 * Mutations: trpc.controls.toggle with optimistic update + reconcile.
 */

import type { RouterOutputs } from "../../lib/trpc";
import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";

// ─── types ────────────────────────────────────────────────────────────────────

type ControlsState = RouterOutputs["controls"]["list"];
type ControlKey = "lamps" | "lights" | "fan";

// ─── fallback data ────────────────────────────────────────────────────────────

const FALLBACK: ControlsState = {
  lamps: { on: true, count: 2, sub: "2 on · warm" },
  lights: { on: false },
  fan: { on: false, sub: "Off" },
};

// ─── ETap — single control button ─────────────────────────────────────────────

interface TapProps {
  icon: "lamp" | "bulb" | "fan";
  label: string;
  on: boolean;
  sub?: string;
  onToggle: () => void;
}

function ETap({ icon, label, on, sub, onToggle }: TapProps) {
  return (
    <button
      type="button"
      className={`tap${on ? " on" : ""}`}
      onClick={onToggle}
      style={{
        padding: 17,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        background: "none",
      }}
      aria-pressed={on}
      aria-label={label}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Icon name={icon} s={26} c={on ? "var(--acc)" : "var(--ink-2)"} />
        <span className="sd" />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 500 }}>{label}</div>
        <div
          className="mono"
          style={{
            fontSize: 12,
            color: on ? "var(--acc)" : "var(--ink-3)",
            marginTop: 4,
            textTransform: "uppercase",
            letterSpacing: ".08em",
          }}
        >
          {on ? (sub ?? "On") : "Off"}
        </div>
      </div>
    </button>
  );
}

// ─── ControlsTile ─────────────────────────────────────────────────────────────

export function ControlsTile() {
  const utils = trpc.useUtils();

  const { data, isError } = trpc.controls.list.useQuery({}, { refetchInterval: 30_000 });

  // Use real data, fall back to placeholder on error or during loading.
  const controls: ControlsState = data ?? FALLBACK;

  const toggleMutation = trpc.controls.toggle.useMutation({
    // Optimistic: flip the local cache immediately.
    onMutate: async ({ key, on }) => {
      await utils.controls.list.cancel();
      const prev = utils.controls.list.getData({});

      utils.controls.list.setData({}, (old) => {
        const base = old ?? FALLBACK;
        if (key === "lamps") {
          return {
            ...base,
            lamps: {
              ...base.lamps,
              on,
              count: on ? Math.max(base.lamps.count, 1) : 0,
              sub: on ? base.lamps.sub : "all off",
            },
          };
        }
        if (key === "lights") {
          return { ...base, lights: { on } };
        }
        // fan
        return {
          ...base,
          fan: {
            ...base.fan,
            on,
            sub: on ? (base.fan.sub === "Off" ? "Medium" : base.fan.sub) : "Off",
          },
        };
      });

      return { prev };
    },

    // Reconcile: on error revert; on success let the next poll refresh.
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) {
        utils.controls.list.setData({}, ctx.prev);
      }
    },
    onSettled: () => {
      utils.controls.list.invalidate();
    },
  });

  function handleToggle(key: ControlKey, currentOn: boolean) {
    toggleMutation.mutate({ key, on: !currentOn });
  }

  return (
    <div
      className="tile"
      style={{
        height: "100%",
        padding: 20,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Icon name="bulb" s={19} c="var(--ink-2)" />
        <span
          style={{
            fontSize: 17.5,
            fontWeight: 600,
            letterSpacing: "-.015em",
            whiteSpace: "nowrap",
          }}
        >
          Controls
        </span>
        {isError && (
          <span className="cap" style={{ marginLeft: "auto", color: "var(--ink-3)" }}>
            cached
          </span>
        )}
      </div>

      {/* 2×2 grid */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 13,
        }}
      >
        <ETap
          icon="lamp"
          label="Lamps"
          on={controls.lamps.on}
          sub={controls.lamps.sub}
          onToggle={() => handleToggle("lamps", controls.lamps.on)}
        />

        <ETap
          icon="bulb"
          label="Lights"
          on={controls.lights.on}
          onToggle={() => handleToggle("lights", controls.lights.on)}
        />

        <ETap
          icon="fan"
          label="Fan"
          on={controls.fan.on}
          sub={controls.fan.sub}
          onToggle={() => handleToggle("fan", controls.fan.on)}
        />

        {/* More — dashed placeholder */}
        <button
          type="button"
          style={{
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
          }}
          aria-label="More controls"
        >
          <Icon name="plus" s={22} c="var(--ink-3)" />
          <span style={{ fontSize: 13 }}>More</span>
        </button>
      </div>
    </div>
  );
}
