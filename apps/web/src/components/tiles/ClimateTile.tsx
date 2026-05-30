import { useCallback, useRef, useState } from "react";
import { POLL } from "../../lib/hooks";
import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";

// Design constants (evee-tiles.jsx EClimate)
const MIN = 65;
const MAX = 80;

type Mode = "cool" | "auto" | "heat";

function modeLabel(mode: Mode): string {
  if (mode === "cool") return "Cooling";
  if (mode === "heat") return "Heating";
  return "Auto";
}

// Derive display mode from setpoint (mirrors design EClimate logic)
function modeFromTarget(target: number): Mode {
  if (target <= 70) return "cool";
  if (target >= 74) return "heat";
  return "auto";
}

// Fallback defaults when no server data
const FALLBACK = { target: 70, ambient: 72, mode: "auto" as Mode, action: "Idle" as const };

export function ClimateTile() {
  const query = trpc.climate.get.useQuery(undefined, {
    refetchInterval: POLL.climate,
  });

  const setTargetMutation = trpc.climate.setTarget.useMutation();
  const setModeMutation = trpc.climate.setMode.useMutation();

  const data = query.data ?? FALLBACK;

  // Optimistic local setpoint — tracks slider while dragging; syncs on commit
  const [localTarget, setLocalTarget] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = localTarget ?? data.target;
  const ambient = data.ambient;

  // Derive display mode: prefer server mode, but let local slider override
  const displayMode: Mode =
    localTarget !== null ? modeFromTarget(localTarget) : (data.mode as Mode);

  const pct = ((target - MIN) / (MAX - MIN)) * 100;
  const ambPct = ((ambient - MIN) / (MAX - MIN)) * 100;

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      setLocalTarget(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setTargetMutation.mutate(val, {
          onSuccess: () => setLocalTarget(null),
          onError: () => setLocalTarget(null),
        });
      }, 400);
    },
    [setTargetMutation],
  );

  const handleChip = useCallback(
    (mode: Mode, presetTarget: number) => {
      setLocalTarget(presetTarget);
      setModeMutation.mutate(mode, {
        onSuccess: () => setLocalTarget(null),
        onError: () => setLocalTarget(null),
      });
    },
    [setModeMutation],
  );

  return (
    <div
      className="tile"
      style={{ height: "100%", padding: 22, display: "flex", flexDirection: "column" }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span className="ic" style={{ width: 26, height: 26, borderRadius: 8 }}>
          <Icon name="thermo" s={16} c="var(--ink-2)" />
        </span>
        <span
          style={{
            fontSize: 17.5,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            whiteSpace: "nowrap",
          }}
        >
          Climate · A/C
        </span>
        <span style={{ marginLeft: "auto" }}>
          <span className={"pill on"} style={{ padding: "4px 10px" }}>
            {modeLabel(displayMode)}
          </span>
        </span>
      </div>

      {/* Big setpoint */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 92, fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.04em" }}
          data-testid="setpoint"
        >
          {target}
          <span style={{ fontSize: 30, color: "var(--ink-2)" }}>°F</span>
        </div>
      </div>

      {/* Mode chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        {(
          [
            ["cool", "Cool", 68],
            ["auto", "Auto", 72],
            ["heat", "Heat", 76],
          ] as [Mode, string, number][]
        ).map(([k, label, presetVal]) => (
          <button
            key={k}
            type="button"
            className={`chip${displayMode === k ? " on" : ""}`}
            onClick={() => handleChip(k, presetVal)}
            aria-pressed={displayMode === k}
            data-testid={`chip-${k}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Slider + ambient "Now" caret */}
      <div style={{ position: "relative", paddingBottom: 28 }}>
        <input
          className="range"
          type="range"
          min={MIN}
          max={MAX}
          value={target}
          style={{ "--p": `${pct}%` } as React.CSSProperties}
          onChange={handleSlider}
          aria-label="Target temperature"
          data-testid="slider"
        />
        {/* Ambient caret marker */}
        <div
          style={{
            position: "absolute",
            left: `${ambPct}%`,
            top: -3,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 2,
              height: 22,
              background: "rgba(255,255,255,.65)",
              borderRadius: 1,
            }}
          />
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-2)", whiteSpace: "nowrap", marginTop: 3 }}
            data-testid="ambient-label"
          >
            {Math.round(ambient)}°
          </span>
        </div>
        {/* Range end labels */}
        <span
          className="mono"
          style={{ position: "absolute", left: 0, bottom: 0, fontSize: 12, color: "var(--ink-3)" }}
        >
          65°
        </span>
        <span
          className="mono"
          style={{ position: "absolute", right: 0, bottom: 0, fontSize: 12, color: "var(--ink-3)" }}
        >
          80°
        </span>
      </div>
    </div>
  );
}
