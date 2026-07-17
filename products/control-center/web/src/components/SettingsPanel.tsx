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

import { type CSSProperties, useState } from "react";
import { deriveDefaultName, setDeviceName, useDeviceName } from "../lib/device-name";
import { openLayoutEditor } from "../lib/layout-edit-store";
import {
  clampBrightness,
  clampDimLevel,
  MAX_BRIGHTNESS,
  MAX_DIM_LEVEL,
  MAX_IDLE_TIMEOUT_MS,
  MIN_BRIGHTNESS,
  MIN_DIM_LEVEL,
  MIN_IDLE_TIMEOUT_MS,
  resetSettings,
  SNAP_MODE_LABEL,
  SNAP_MODES,
  setActiveBrightness,
  setIdleDimEnabled,
  setIdleDimLevel,
  setIdleDimTimeoutMs,
  setRecenterEnabled,
  setRecenterTimeoutMs,
  setShowBuildBadge,
  setShowFps,
  setSnapMode,
  useSettings,
} from "../lib/settings";
import { LogsModal } from "./LogsModal";
import { Segmented } from "./ui/Segmented";
import { Slider } from "./ui/Slider";
import { Switch } from "./ui/Switch";
import { TextInput } from "./ui/TextInput";

const MS_PER_MIN = 60_000;
const MIN_MINUTES = Math.round(MIN_IDLE_TIMEOUT_MS / MS_PER_MIN);
const MAX_MINUTES = Math.round(MAX_IDLE_TIMEOUT_MS / MS_PER_MIN);

const SNAP_OPTIONS = SNAP_MODES.map((value) => ({ value, label: SNAP_MODE_LABEL[value] }));

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

// One labeled row: name (+ optional sub) on the left, control on the right.
function Row({ label, sub, control }: { label: string; sub?: string; control: React.ReactNode }) {
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
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: "var(--ui)", fontSize: 15, color: "var(--ink)" }}>{label}</span>
        {sub ? (
          <span style={{ fontFamily: "var(--ui)", fontSize: 12, color: "var(--ink-3)" }}>
            {sub}
          </span>
        ) : null}
      </div>
      {control}
    </div>
  );
}

// A full-width labeled field: name (+ optional sub) stacked above a control
// that spans the panel (used for the segmented snap picker).
function StackField({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: "var(--ui)", fontSize: 15, color: "var(--ink)" }}>{label}</span>
        {sub ? (
          <span style={{ fontFamily: "var(--ui)", fontSize: 12, color: "var(--ink-3)" }}>
            {sub}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
}

export type SettingsPanelProps = {
  // Called after "Edit layout" opens the editor, so the host (SettingsButton)
  // can close the settings modal out of the way. Optional so the panel still
  // renders standalone (e.g. in Storybook) without a host modal to close.
  onClose?: () => void;
};

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useSettings();
  const { name: deviceName, isSet: deviceNameSet } = useDeviceName();
  const [logsOpen, setLogsOpen] = useState(false);
  const brightnessPercent = Math.round(settings.activeBrightness * 100);
  const dimMinutes = Math.round(settings.idleDimTimeoutMs / MS_PER_MIN);
  const dimPercent = Math.round(settings.idleDimLevel * 100);
  const recenterMinutes = Math.round(settings.recenterTimeoutMs / MS_PER_MIN);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Section>
        <SectionTitle>Device</SectionTitle>
        <StackField
          label="Device name"
          sub="Names this panel in its logs. Stored on this device only, never shared."
        >
          {/* Value shows the user's chosen name (empty until they set one, so the
              placeholder reveals the auto-derived default); clearing it reverts to
              that default and re-raises the "set your device name" banner. */}
          <TextInput
            label="Device name"
            value={deviceNameSet ? deviceName : ""}
            placeholder={deriveDefaultName()}
            onChange={setDeviceName}
          />
        </StackField>
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
        <Row
          label="Edit layout"
          sub="Rearrange tiles on the board."
          control={
            <button
              type="button"
              onClick={() => {
                openLayoutEditor();
                onClose?.();
              }}
              style={FOOTER_BUTTON}
            >
              Edit layout
            </button>
          }
        />
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

      {/* Left: the debug log viewer , the only window into a TestFlight kiosk
          build, which no external debugger can attach to. Right: restore every
          setting to its default (and sync the reset to other panels). */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <button type="button" onClick={() => setLogsOpen(true)} style={FOOTER_BUTTON}>
          View logs
        </button>
        <button type="button" onClick={resetSettings} style={FOOTER_BUTTON}>
          Reset to defaults
        </button>
      </div>

      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
    </div>
  );
}

const FOOTER_BUTTON: CSSProperties = {
  padding: "8px 14px",
  background: "var(--nest)",
  border: "1px solid var(--hair)",
  borderRadius: 10,
  fontFamily: "var(--ui)",
  fontSize: 13,
  color: "var(--ink-2)",
  cursor: "pointer",
};
