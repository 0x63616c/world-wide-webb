/**
 * SettingsPanel , the body of the settings modal. Reads the shared settings
 * store (lib/settings) and writes through its module-level setters, so it holds
 * no local state of its own and every edit is instantly live across the board
 * (idle-dim + recenter hooks, FPS meter, build badge, snap mode).
 *
 * Grouped into Display (brightness/dimming), Board (idle recenter + settle
 * feel), and Debug (the on-screen dev readouts). A group's sub-settings only
 * render while its parent toggle is on , an off feature shows just its switch.
 */

import { useState } from "react";

import {
  clampBrightness,
  clampDimLevel,
  MAX_BRIGHTNESS,
  MAX_DIM_LEVEL,
  MAX_FADE_MS,
  MAX_IDLE_TIMEOUT_MS,
  MAX_SUN_OFFSET_MIN,
  MIN_BRIGHTNESS,
  MIN_DIM_LEVEL,
  MIN_FADE_MS,
  MIN_IDLE_TIMEOUT_MS,
  MIN_SUN_OFFSET_MIN,
  resetSettings,
  SNAP_MODE_LABEL,
  SNAP_MODES,
  setActiveBrightness,
  setDimFadeMs,
  setIdleDimEnabled,
  setIdleDimLevel,
  setIdleDimTimeoutMs,
  setRecenterEnabled,
  setRecenterTimeoutMs,
  setShowBuildBadge,
  setShowFps,
  setSnapMode,
  setThemeFadeMs,
  setThemeMode,
  setThemeSunOffsetMin,
  THEME_MODE_LABEL,
  THEME_MODES,
  useSettings,
} from "../lib/settings";
import { Segmented } from "./ui/Segmented";
import { Slider } from "./ui/Slider";
import { Switch } from "./ui/Switch";

const MS_PER_MIN = 60_000;
const MIN_MINUTES = Math.round(MIN_IDLE_TIMEOUT_MS / MS_PER_MIN);
const MAX_MINUTES = Math.round(MAX_IDLE_TIMEOUT_MS / MS_PER_MIN);

const SNAP_OPTIONS = SNAP_MODES.map((value) => ({ value, label: SNAP_MODE_LABEL[value] }));
const THEME_OPTIONS = THEME_MODES.map((value) => ({ value, label: THEME_MODE_LABEL[value] }));

// Label + optional tappable (i) that toggles a longer explanation below , the
// panel is a touch surface, so hover tooltips don't work; tap to reveal.
function LabelWithInfo({ label, sub, info }: { label: string; sub?: string; info?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontFamily: "var(--ui)",
          fontSize: 15,
          color: "var(--ink)",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {label}
        {info ? (
          <button
            type="button"
            aria-label={`About ${label}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "1px solid var(--hair-2)",
              background: open ? "var(--acc-dim)" : "transparent",
              color: open ? "var(--acc)" : "var(--ink-3)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              lineHeight: 1,
              cursor: "pointer",
              padding: 0,
              flex: "0 0 auto",
            }}
          >
            i
          </button>
        ) : null}
      </span>
      {sub ? (
        <span style={{ fontFamily: "var(--ui)", fontSize: 12, color: "var(--ink-3)" }}>{sub}</span>
      ) : null}
      {info && open ? (
        <span
          style={{
            fontFamily: "var(--ui)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--ink-2)",
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 10,
            padding: "8px 10px",
            marginTop: 4,
          }}
        >
          {info}
        </span>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "var(--ink-3)",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

// One labeled row: name (+ optional sub / (i) hint) left, control right.
function Row({
  label,
  sub,
  info,
  control,
}: {
  label: string;
  sub?: string;
  info?: string;
  control: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        minHeight: 34,
      }}
    >
      <LabelWithInfo label={label} sub={sub} info={info} />
      {control}
    </div>
  );
}

// A full-width labeled field: name (+ optional sub / (i) hint) stacked above a
// control that spans the panel (used for the segmented pickers).
function StackField({
  label,
  sub,
  info,
  children,
}: {
  label: string;
  sub?: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <LabelWithInfo label={label} sub={sub} info={info} />
      {children}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
}

export function SettingsPanel() {
  const settings = useSettings();
  const brightnessPercent = Math.round(settings.activeBrightness * 100);
  const dimMinutes = Math.round(settings.idleDimTimeoutMs / MS_PER_MIN);
  const dimPercent = Math.round(settings.idleDimLevel * 100);
  const recenterMinutes = Math.round(settings.recenterTimeoutMs / MS_PER_MIN);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Section>
        <SectionTitle>Appearance</SectionTitle>
        <StackField
          label="Theme"
          sub="Color theme for every panel , synced across devices."
          info="Light and dark force one look. Auto follows the sun at the home location: light after sunrise, dark after sunset, using the sun times from the weather feed. The offset below shifts both switch points."
        >
          <Segmented
            label="Theme"
            options={THEME_OPTIONS}
            value={settings.themeMode}
            onChange={setThemeMode}
          />
        </StackField>
        {settings.themeMode === "auto" ? (
          <Slider
            label="Sun offset"
            value={settings.themeSunOffsetMin}
            min={MIN_SUN_OFFSET_MIN}
            max={MAX_SUN_OFFSET_MIN}
            step={5}
            format={(n) => `${n >= 0 ? "+" : ""}${n} min`}
            onChange={setThemeSunOffsetMin}
          />
        ) : null}
        <Slider
          label="Theme fade"
          value={settings.themeFadeMs}
          min={MIN_FADE_MS}
          max={MAX_FADE_MS}
          step={100}
          format={(n) => `${(n / 1000).toFixed(1)}s`}
          onChange={setThemeFadeMs}
        />
      </Section>

      <Section>
        <SectionTitle>Display</SectionTitle>
        <Slider
          label="Brightness"
          value={brightnessPercent}
          min={Math.round(MIN_BRIGHTNESS * 100)}
          max={Math.round(MAX_BRIGHTNESS * 100)}
          step={1}
          format={(n) => `${n}%`}
          onChange={(pct) => setActiveBrightness(clampBrightness(pct / 100))}
        />
        <Row
          label="Dim when idle"
          sub="Lower the panel brightness after a period of no interaction."
          info="Native panels drop the real backlight to the dim level after the idle window, then restore it on the next tap. Dim fade sets how long the backlight ramps between the two levels instead of snapping."
          control={
            <Switch
              label="Dim when idle"
              checked={settings.idleDimEnabled}
              onChange={setIdleDimEnabled}
            />
          }
        />
        {settings.idleDimEnabled ? (
          <>
            <Slider
              label="Dim after"
              value={dimMinutes}
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              step={1}
              format={(n) => `${n} min`}
              onChange={(min) => setIdleDimTimeoutMs(min * MS_PER_MIN)}
            />
            <Slider
              label="Dim level"
              value={dimPercent}
              min={Math.round(MIN_DIM_LEVEL * 100)}
              max={Math.round(MAX_DIM_LEVEL * 100)}
              step={1}
              format={(n) => `${n}%`}
              onChange={(pct) => setIdleDimLevel(clampDimLevel(pct / 100))}
            />
            <Slider
              label="Dim fade"
              value={settings.dimFadeMs}
              min={MIN_FADE_MS}
              max={MAX_FADE_MS}
              step={100}
              format={(n) => `${(n / 1000).toFixed(1)}s`}
              onChange={setDimFadeMs}
            />
          </>
        ) : null}
      </Section>

      <Section>
        <SectionTitle>Board</SectionTitle>
        <Row
          label="Recenter when idle"
          sub="Glide back to the Clock after a period of no interaction."
          control={
            <Switch
              label="Recenter when idle"
              checked={settings.recenterEnabled}
              onChange={setRecenterEnabled}
            />
          }
        />
        {settings.recenterEnabled ? (
          <Slider
            label="Recenter after"
            value={recenterMinutes}
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={1}
            format={(n) => `${n} min`}
            onChange={(min) => setRecenterTimeoutMs(min * MS_PER_MIN)}
          />
        ) : null}
        <StackField label="Board snap" sub="How the board settles when you let go of a pan.">
          <Segmented
            label="Board snap"
            options={SNAP_OPTIONS}
            value={settings.snapMode}
            onChange={setSnapMode}
          />
        </StackField>
      </Section>

      <Section>
        <SectionTitle>Debug</SectionTitle>
        <Row
          label="FPS meter"
          sub="Show the live frame-rate readout."
          control={<Switch label="FPS meter" checked={settings.showFps} onChange={setShowFps} />}
        />
        <Row
          label="Build badge"
          sub="Show the build hash + age readout."
          control={
            <Switch
              label="Build badge"
              checked={settings.showBuildBadge}
              onChange={setShowBuildBadge}
            />
          }
        />
      </Section>

      {/* Restore every setting to its default (and sync the reset to other panels). */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button
          type="button"
          onClick={resetSettings}
          style={{
            padding: "8px 14px",
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 10,
            fontFamily: "var(--ui)",
            fontSize: 13,
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
