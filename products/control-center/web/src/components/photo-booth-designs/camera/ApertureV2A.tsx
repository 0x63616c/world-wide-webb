/**
 * Aperture V2A , "Sheet". Keeps the iOS-minimal Aperture feel but fixes the
 * three rough edges:
 *   • Timer , the bare "Off" word becomes the house {@link Segmented} control
 *     led by a Timer glyph, so it reads as a real app control with an obvious
 *     "this is a self-timer" cue.
 *   • Filters , the always-visible swatch ramp collapses into one "Filters"
 *     trigger that raises a bottom sheet of swatches; the trigger shows the
 *     active filter's name.
 *   • The whole bottom cluster lifts off the panel's bottom edge for breathing
 *     room, and the gallery button adopts the house control-cell look.
 */

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Icon } from "../../Icon";
import { Segmented } from "../../ui/Segmented";
import {
  FlashButton,
  filterById,
  GalleryButton,
  glassPanel,
  MenuScrim,
  menuCap,
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
  useCapture,
} from "./camera-shared";
import { CameraKeyframes, CountdownOverlay, FlashOverlay, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

const TIMER_SEGMENTS = COUNTDOWN_OPTIONS.map((s) => ({
  value: String(s),
  label: s === 0 ? "Off" : `${s}s`,
}));

export function ApertureV2A() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
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
            {/* Timer as the house Segmented control, led by a Timer glyph. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 10px 6px 14px",
                ...glassPanel(),
                borderRadius: 14,
                width: 300,
              }}
            >
              <Icon name="timer" s={19} c={countdown === 0 ? "var(--ink-2)" : "var(--amber)"} />
              <div style={{ flex: 1 }}>
                <Segmented
                  label="Self-timer"
                  options={TIMER_SEGMENTS}
                  value={String(countdown)}
                  onChange={(v) => setCountdown(Number(v) as CountdownOption)}
                />
              </div>
            </div>
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
          {/* Filters trigger , shows active filter name, opens the sheet. */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
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
            <SlidersHorizontal size={17} strokeWidth={2} />
            <span style={{ color: "var(--ink-2)" }}>Filter</span>
            <Swatch filter={active} active={false} size={18} />
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

          {/* Mode row , house chips. */}
          <div style={{ display: "flex", gap: 8, width: 620 }}>
            {CAMERA_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={m.disabled}
                onClick={() => !m.disabled && setMode(m.id)}
                className={`chip${m.id === mode ? " on" : ""}`}
                style={{ opacity: m.disabled ? 0.4 : 1, textTransform: "uppercase", fontSize: 12 }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bottom sheet of filter swatches. */}
        {sheetOpen && (
          <>
            <MenuScrim onClose={() => setSheetOpen(false)} />
            <div
              role="dialog"
              aria-label="Choose filter"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 31,
                ...glassPanel(),
                borderRadius: "22px 22px 0 0",
                padding: "16px 34px 30px",
                animation: "pbSheetUp 0.24s cubic-bezier(0.16,1,0.3,1)",
              }}
            >
              <style>{`@keyframes pbSheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
              <div
                aria-hidden
                style={{
                  width: 44,
                  height: 5,
                  borderRadius: 999,
                  background: "var(--hair-2)",
                  margin: "0 auto 16px",
                }}
              />
              {menuCap("Filters")}
              <div style={{ display: "flex", gap: 22, marginTop: 14, justifyContent: "center" }}>
                {CAMERA_FILTERS.map((f) => {
                  const on = f.id === filter;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setFilter(f.id);
                        setSheetOpen(false);
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 9,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: on ? "var(--ink)" : "var(--ink-2)",
                        fontFamily: "var(--ui)",
                      }}
                    >
                      <Swatch filter={f} active={on} size={58} />
                      <span style={{ fontSize: 13, fontWeight: on ? 600 : 500 }}>{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}
