/**
 * Display settings page , brightness, idle dimming, and the clean-screen
 * launcher. Reads/writes the shared settings store through its module setters
 * (clamped writes), mirroring the old SettingsPanel's Display section. The
 * idle-dim sub-sliders only render while the parent toggle is on.
 */

import {
  clampBrightness,
  clampDimLevel,
  MAX_BRIGHTNESS,
  MAX_DIM_LEVEL,
  MAX_IDLE_TIMEOUT_MS,
  MIN_BRIGHTNESS,
  MIN_DIM_LEVEL,
  MIN_IDLE_TIMEOUT_MS,
  setAccent,
  setActiveBrightness,
  setIdleDimEnabled,
  setIdleDimLevel,
  setIdleDimTimeoutMs,
  setTypeface,
  useSettings,
} from "../../../lib/settings";
import { Slider } from "../../ui/Slider";
import { Switch } from "../../ui/Switch";
import { AccentPicker } from "../AccentPicker";
import { ActionButton, RowShell, SectionCard, SliderRow } from "../blocks";
import type { PageProps } from "../SettingsPage";
import { TypefacePicker } from "../TypefacePicker";

const MS_PER_MIN = 60_000;
const MIN_MINUTES = Math.round(MIN_IDLE_TIMEOUT_MS / MS_PER_MIN);
const MAX_MINUTES = Math.round(MAX_IDLE_TIMEOUT_MS / MS_PER_MIN);

export function DisplayPage({ onOpenClean }: PageProps) {
  const settings = useSettings();
  const brightnessPercent = Math.round(settings.activeBrightness * 100);
  const dimMinutes = Math.round(settings.idleDimTimeoutMs / MS_PER_MIN);
  const dimPercent = Math.round(settings.idleDimLevel * 100);

  return (
    <>
      <SectionCard title="Accent">
        {[
          <RowShell
            key="accent"
            label="Accent colour"
            sub="The highlight colour used across the board, including the maps."
            control={<AccentPicker value={settings.accent} onChange={setAccent} />}
          />,
        ]}
      </SectionCard>

      <SectionCard title="Typeface">
        {[
          <RowShell
            key="typeface"
            label="Type pair"
            sub="The sans and its mono, used everywhere on the board."
            control={<TypefacePicker value={settings.typeface} onChange={setTypeface} />}
            stack
          />,
        ]}
      </SectionCard>

      <SectionCard title="Brightness">
        {[
          <SliderRow key="brightness">
            <Slider
              label="Brightness"
              value={brightnessPercent}
              min={Math.round(MIN_BRIGHTNESS * 100)}
              max={Math.round(MAX_BRIGHTNESS * 100)}
              step={1}
              format={(n) => `${n}%`}
              onChange={(pct) => setActiveBrightness(clampBrightness(pct / 100))}
            />
          </SliderRow>,
        ]}
      </SectionCard>

      <SectionCard title="Idle dimming">
        {[
          <RowShell
            key="dim"
            label="Dim when idle"
            sub="Lower the panel brightness after a period of no interaction."
            control={
              <Switch
                label="Dim when idle"
                checked={settings.idleDimEnabled}
                onChange={setIdleDimEnabled}
              />
            }
          />,
          ...(settings.idleDimEnabled
            ? [
                <SliderRow key="dim-after">
                  <Slider
                    label="Dim after"
                    value={dimMinutes}
                    min={MIN_MINUTES}
                    max={MAX_MINUTES}
                    step={1}
                    format={(n) => `${n} min`}
                    onChange={(min) => setIdleDimTimeoutMs(min * MS_PER_MIN)}
                  />
                </SliderRow>,
                <SliderRow key="dim-level">
                  <Slider
                    label="Dim level"
                    value={dimPercent}
                    min={Math.round(MIN_DIM_LEVEL * 100)}
                    max={Math.round(MAX_DIM_LEVEL * 100)}
                    step={1}
                    format={(n) => `${n}%`}
                    onChange={(pct) => setIdleDimLevel(clampDimLevel(pct / 100))}
                  />
                </SliderRow>,
              ]
            : []),
        ]}
      </SectionCard>

      <SectionCard title="Maintenance">
        {[
          <RowShell
            key="clean"
            label="Clean screen"
            sub="Locks touches while you wipe the screen."
            control={<ActionButton onClick={onOpenClean}>Start</ActionButton>}
          />,
        ]}
      </SectionCard>
    </>
  );
}
