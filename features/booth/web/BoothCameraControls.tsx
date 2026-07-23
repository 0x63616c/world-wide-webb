/**
 * BoothCameraControls , the chrome atoms and clusters overlaid on the live
 * preview: the top-right filter/timer/flash cluster, the bottom gallery/shutter/
 * mode cluster, and the filter picker Modal. Split out of BoothCamera so the
 * screen file stays a thin composition. Controls sit over the frame as
 * translucent dark glass so they read against any scene while still speaking the
 * app's token language (--acc, --amber, --hair-2, --ink*). Adapted from the
 * throwaway ApertureV3 prototype's apertureV2-kit.
 */

import { Images, X, Zap, ZapOff } from "lucide-react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import {
  CAMERA_FILTERS,
  type CameraFilter,
  type CountdownOption,
  countdownLabel,
  filterById,
  MODE_SEGMENTS,
  type ModeValue,
} from "./camera-model";

/** Round 48px glass control. Active brightens to the accent; `amber` uses the flash tint. */
function glassBtn(active = false, amber = false): CSSProperties {
  const onBg = amber ? "var(--amber)" : "var(--acc)";
  const onInk = amber ? "#1a1206" : "var(--bg)";
  return {
    height: 48,
    width: 48,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--hair-2)",
    cursor: "pointer",
    background: active ? onBg : "rgba(10,10,10,0.5)",
    color: active ? onInk : "var(--ink)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    fontFamily: "var(--ui)",
  };
}

/** Round filter swatch dot; ring brightens to the accent when active. */
function Swatch({
  filter,
  active,
  size = 46,
}: {
  filter: CameraFilter;
  active: boolean;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: filter.swatch,
        flex: "0 0 auto",
        boxShadow: active
          ? "0 0 0 2px var(--bg), 0 0 0 4px var(--acc)"
          : "inset 0 0 0 1px var(--hair-2)",
        transition: "box-shadow 0.15s ease",
      }}
    />
  );
}

/** Top + bottom scrims so chrome stays legible over a bright frame. */
export function Scrim({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        height: 190,
        [edge]: 0,
        background:
          edge === "top"
            ? "linear-gradient(180deg, rgba(0,0,0,0.55), transparent)"
            : "linear-gradient(0deg, rgba(0,0,0,0.62), transparent)",
        pointerEvents: "none",
      }}
    />
  );
}

interface TopControlsProps {
  filterId: string;
  onOpenFilters: () => void;
  countdown: CountdownOption;
  onCycleTimer: () => void;
  flashOn: boolean;
  onToggleFlash: () => void;
  onClose?: () => void;
}

/**
 * Top bar , optional close on the left; filter · timer · flash on the right
 * (flash outermost). Timer is one button cycling Off → 1 → 3 → 5 → 10s: off is a
 * grayed icon-only circle, armed is an amber capsule with the value.
 */
export function TopControls({
  filterId,
  onOpenFilters,
  countdown,
  onCycleTimer,
  flashOn,
  onToggleFlash,
  onClose,
}: TopControlsProps) {
  const active = filterById(filterId);
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: onClose ? "space-between" : "flex-end",
        padding: "26px 34px",
      }}
    >
      {onClose && (
        <button type="button" style={glassBtn(false)} onClick={onClose} aria-label="Close camera">
          <X size={23} strokeWidth={2} />
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={onOpenFilters}
          aria-label={`Filters, ${active.label}`}
          aria-haspopup="dialog"
          style={glassBtn(false)}
        >
          <Swatch filter={active} active={filterId !== "none"} size={22} />
        </button>
        <button
          type="button"
          onClick={onCycleTimer}
          aria-label={`Self-timer ${countdownLabel(countdown)}`}
          style={{
            ...glassBtn(countdown !== 0, true),
            width: "auto",
            minWidth: 48,
            borderRadius: 999,
            padding: countdown === 0 ? 0 : "0 16px 0 14px",
            gap: 7,
          }}
        >
          <Icon name="timer" s={20} c={countdown === 0 ? "var(--ink-3)" : "currentColor"} />
          {countdown !== 0 && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 15 }}>
              {countdownLabel(countdown)}
            </span>
          )}
        </button>
        <button
          type="button"
          style={glassBtn(flashOn, true)}
          onClick={onToggleFlash}
          aria-label={flashOn ? "Flash on" : "Flash off"}
          aria-pressed={flashOn}
        >
          {flashOn ? <Zap size={21} strokeWidth={2} /> : <ZapOff size={21} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}

interface BottomControlsProps {
  mode: ModeValue;
  onModeChange: (mode: ModeValue) => void;
  onShoot: () => void;
  onOpenGallery: () => void;
  capturing: boolean;
  busy: boolean;
}

/** Bottom cluster , gallery left, ring shutter center, mode segmented below. */
export function BottomControls({
  mode,
  onModeChange,
  onShoot,
  onOpenGallery,
  capturing,
  busy,
}: BottomControlsProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "0 0 62px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 30,
      }}
    >
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 60px",
        }}
      >
        <div style={{ justifySelf: "start" }}>
          <button
            type="button"
            onClick={onOpenGallery}
            aria-label="Open gallery"
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              border: "1px solid var(--hair-2)",
              background: "rgba(10,10,10,0.5)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              color: "var(--ink)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.05)",
            }}
          >
            <Images size={24} strokeWidth={1.8} />
          </button>
        </div>
        <button
          type="button"
          onClick={onShoot}
          disabled={busy}
          aria-label="Shutter"
          style={{
            width: 86,
            height: 86,
            borderRadius: "50%",
            border: "5px solid #fff",
            background: "#fff",
            boxShadow: "0 0 0 3px #000",
            cursor: busy ? "default" : "pointer",
            opacity: busy && !capturing ? 0.55 : 1,
            transform: capturing ? "scale(0.88)" : "scale(1)",
            transition: "transform 0.12s ease, opacity 0.15s ease",
          }}
        />
        <div style={{ justifySelf: "end" }} />
      </div>

      <div style={{ width: 620 }}>
        <Segmented<ModeValue>
          label="Capture mode"
          options={MODE_SEGMENTS}
          value={mode}
          onChange={(next) => {
            const segment = MODE_SEGMENTS.find((m) => m.value === next);
            if (!segment?.disabled) onModeChange(next);
          }}
        />
      </div>
    </div>
  );
}

interface FilterModalProps {
  open: boolean;
  onClose: () => void;
  filterId: string;
  onSelect: (id: string) => void;
}

/** House Modal with the swatch grid of the 7 CSS filters. */
export function FilterModal({ open, onClose, filterId, onSelect }: FilterModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Filter" width={560}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {CAMERA_FILTERS.map((f) => {
          const on = f.id === filterId;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                onSelect(f.id);
                onClose();
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "14px 8px",
                borderRadius: 14,
                cursor: "pointer",
                border: on ? "1px solid var(--acc-line)" : "1px solid var(--hair)",
                background: on ? "var(--acc-dim)" : "var(--tile-2)",
                color: on ? "var(--acc)" : "var(--ink-2)",
                fontFamily: "var(--ui)",
              }}
            >
              <Swatch filter={f} active={on} size={54} />
              <span style={{ fontSize: 13, fontWeight: on ? 600 : 500 }}>{f.label}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
