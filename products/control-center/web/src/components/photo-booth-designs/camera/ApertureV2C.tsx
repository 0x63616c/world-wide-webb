/**
 * Aperture V2C , "Panel". Leans on the app's real dialog + segmented primitives.
 *   • Timer , a collapsed Timer-glyph button that, on tap, expands into a row
 *     of option pills (Off · 1s · 3s · 5s · 10s); picking one collapses it back
 *     and the glyph carries the chosen value. No bare word, ever.
 *   • Filters , a "Filter" pill opens the house {@link Modal} with a swatch
 *     grid; the trigger shows the active filter name.
 *   • Modes , the bottom row is the house {@link Segmented} control, and the
 *     whole cluster lifts off the panel's bottom edge.
 */

import { useState } from "react";
import { Icon } from "../../Icon";
import { Modal } from "../../ui/Modal";
import { Segmented } from "../../ui/Segmented";
import {
  FlashButton,
  filterById,
  GalleryButton,
  glassBtn,
  glassPanel,
  Scrim,
  Swatch,
  TopClose,
} from "./apertureV2-kit";
import { CameraStage } from "./CameraStage";
import {
  CAMERA_FILTERS,
  CAMERA_MODES,
  COUNTDOWN_OPTIONS,
  type CountdownOption,
  countdownLabel,
  useCapture,
} from "./camera-shared";
import { CameraKeyframes, CountdownOverlay, FlashOverlay, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

const MODE_SEGMENTS = CAMERA_MODES.map((m) => ({ value: m.id, label: m.label }));
const DISABLED_MODES = new Set(CAMERA_MODES.filter((m) => m.disabled).map((m) => m.id));

export function ApertureV2C() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const capture = useCapture({ countdown, flashOn });
  const active = filterById(filter);

  return (
    <div style={panelRoot("#000")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
        <Scrim edge="top" />
        <Scrim edge="bottom" />

        {/* Top bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "26px 34px",
          }}
        >
          <TopClose />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FlashButton on={flashOn} onToggle={() => setFlashOn((v) => !v)} />
            {/* Expanding timer row. */}
            {timerOpen ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: 48,
                  padding: "0 6px 0 14px",
                  ...glassPanel(),
                  borderRadius: 999,
                  animation: "pbGrow 0.18s ease-out",
                }}
              >
                <style>{`@keyframes pbGrow{from{opacity:0;transform:scale(0.94)}to{opacity:1;transform:scale(1)}}`}</style>
                <Icon name="timer" s={18} c="var(--ink-2)" />
                {COUNTDOWN_OPTIONS.map((s) => {
                  const on = s === countdown;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setCountdown(s);
                        setTimerOpen(false);
                      }}
                      aria-label={`Self-timer ${countdownLabel(s)}`}
                      style={{
                        height: 36,
                        minWidth: 42,
                        padding: "0 10px",
                        borderRadius: 999,
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "var(--mono)",
                        fontSize: 14,
                        background: on ? "var(--amber)" : "transparent",
                        color: on ? "#1a1206" : "var(--ink-2)",
                      }}
                    >
                      {countdownLabel(s)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setTimerOpen(true)}
                aria-label={`Self-timer ${countdownLabel(countdown)}`}
                style={{
                  ...glassBtn(countdown !== 0, true),
                  width: "auto",
                  minWidth: 48,
                  padding: countdown === 0 ? 0 : "0 16px 0 14px",
                  gap: 7,
                }}
              >
                <Icon name="timer" s={20} />
                {countdown !== 0 && (
                  <span style={{ fontFamily: "var(--mono)", fontSize: 15 }}>
                    {countdownLabel(countdown)}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        <CountdownOverlay count={capture.count} />

        {/* Bottom cluster , lifted off the bottom edge. */}
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
            gap: 26,
          }}
        >
          {/* Filters trigger , opens the house Modal. */}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filters"
            aria-haspopup="dialog"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 16px",
              ...glassPanel(),
              borderRadius: 999,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            <Swatch filter={active} active={false} size={18} />
            <span style={{ color: "var(--ink-2)" }}>Filter</span>
            <span style={{ fontWeight: 600 }}>{active.label}</span>
          </button>

          {/* Shutter row */}
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
              <GalleryButton />
            </div>
            <button
              type="button"
              onClick={capture.shoot}
              aria-label="Shutter"
              style={{
                width: 86,
                height: 86,
                borderRadius: "50%",
                border: "5px solid #fff",
                background: "#fff",
                boxShadow: "0 0 0 3px #000",
                cursor: "pointer",
                transform: capture.capturing ? "scale(0.88)" : "scale(1)",
                transition: "transform 0.12s ease",
              }}
            />
            <div style={{ justifySelf: "end" }} />
          </div>

          {/* Mode row , house Segmented (disabled modes are inert). */}
          <div style={{ width: 620 }}>
            <Segmented
              label="Capture mode"
              options={MODE_SEGMENTS}
              value={mode}
              onChange={(next) => {
                if (!DISABLED_MODES.has(next)) setMode(next);
              }}
            />
          </div>
        </div>

        <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter" width={560}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 18,
            }}
          >
            {CAMERA_FILTERS.map((f) => {
              const on = f.id === filter;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFilter(f.id);
                    setFiltersOpen(false);
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

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}
