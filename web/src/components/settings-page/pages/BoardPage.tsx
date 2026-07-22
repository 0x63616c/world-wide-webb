/**
 * Board settings page , idle recenter, board feel (minimap + snap), and the
 * layout editor launcher. Reads/writes the shared settings store through its
 * module setters, mirroring the old SettingsPanel's Board section. The
 * recenter-after slider only renders while recenter is on.
 */

import { openLayoutEditor } from "../../../lib/layout-edit-store";
import {
  MAX_IDLE_TIMEOUT_MS,
  MIN_IDLE_TIMEOUT_MS,
  SNAP_MODE_LABEL,
  SNAP_MODES,
  setRecenterEnabled,
  setRecenterTimeoutMs,
  setShowMinimap,
  setSnapMode,
  useSettings,
} from "../../../lib/settings";
import { Segmented } from "../../ui/Segmented";
import { Slider } from "../../ui/Slider";
import { Switch } from "../../ui/Switch";
import { ActionButton, RowShell, SectionCard, SliderRow } from "../blocks";
import type { PageProps } from "../SettingsPage";

const MS_PER_MIN = 60_000;
const MIN_MINUTES = Math.round(MIN_IDLE_TIMEOUT_MS / MS_PER_MIN);
const MAX_MINUTES = Math.round(MAX_IDLE_TIMEOUT_MS / MS_PER_MIN);

const SNAP_OPTIONS = SNAP_MODES.map((value) => ({ value, label: SNAP_MODE_LABEL[value] }));

export function BoardPage({ onClose }: PageProps) {
  const settings = useSettings();
  const recenterMinutes = Math.round(settings.recenterTimeoutMs / MS_PER_MIN);

  return (
    <>
      <SectionCard title="Idle behavior">
        {[
          <RowShell
            key="recenter"
            label="Recenter when idle"
            sub="Glide back to the Clock after a period of no interaction."
            control={
              <Switch
                label="Recenter when idle"
                checked={settings.recenterEnabled}
                onChange={setRecenterEnabled}
              />
            }
          />,
          ...(settings.recenterEnabled
            ? [
                <SliderRow key="recenter-after">
                  <Slider
                    label="Recenter after"
                    value={recenterMinutes}
                    min={MIN_MINUTES}
                    max={MAX_MINUTES}
                    step={1}
                    format={(n) => `${n} min`}
                    onChange={(min) => setRecenterTimeoutMs(min * MS_PER_MIN)}
                  />
                </SliderRow>,
              ]
            : []),
        ]}
      </SectionCard>

      <SectionCard title="Feel">
        {[
          <RowShell
            key="minimap"
            label="Minimap"
            sub="Show the little board map in the corner."
            control={
              <Switch label="Minimap" checked={settings.showMinimap} onChange={setShowMinimap} />
            }
          />,
          <div key="snap" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: "var(--ui)", fontSize: 15, color: "var(--ink)" }}>
              Board snap
            </span>
            <span style={{ fontFamily: "var(--ui)", fontSize: 12, color: "var(--ink-3)" }}>
              How the board settles when you let go of a pan.
            </span>
            <Segmented
              label="Board snap"
              options={SNAP_OPTIONS}
              value={settings.snapMode}
              onChange={setSnapMode}
            />
          </div>,
        ]}
      </SectionCard>

      <SectionCard title="Layout">
        {[
          <RowShell
            key="edit"
            label="Edit layout"
            sub="Rearrange tiles on the board."
            control={
              <ActionButton
                onClick={() => {
                  openLayoutEditor();
                  onClose();
                }}
              >
                Edit layout
              </ActionButton>
            }
          />,
        ]}
      </SectionCard>
    </>
  );
}
