/**
 * Aperture V3 , the converged design from user feedback on V2:
 *   • Timer , ONE button, no menu: each tap cycles Off → 1s → 3s → 5s → 10s.
 *     The timer glyph always sits on the left, the current value on the right.
 *   • Top-right cluster, left → right: filter (colour-dot icon), timer, flash
 *     (flash always outermost right).
 *   • Filters , the trigger is an icon-only button whose dot shows the active
 *     filter colour; it opens the house {@link Modal} swatch grid.
 *   • Modes , house {@link Segmented}; bottom cluster lifted off the edge.
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

function nextCountdown(current: CountdownOption): CountdownOption {
  const i = COUNTDOWN_OPTIONS.indexOf(current);
  return COUNTDOWN_OPTIONS[(i + 1) % COUNTDOWN_OPTIONS.length];
}

export function ApertureV3() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const capture = useCapture({ countdown, flashOn });
  const active = filterById(filter);

  return (
    <div style={panelRoot("#000")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
        <Scrim edge="top" />
        <Scrim edge="bottom" />

        {/* Top bar , close left; filter · timer · flash right (flash outermost). */}
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
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-label={`Filters , ${active.label}`}
              aria-haspopup="dialog"
              style={glassBtn(false)}
            >
              <Swatch filter={active} active={filter !== "none"} size={22} />
            </button>
            <button
              type="button"
              onClick={() => setCountdown(nextCountdown)}
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
            <FlashButton on={flashOn} onToggle={() => setFlashOn((v) => !v)} />
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
