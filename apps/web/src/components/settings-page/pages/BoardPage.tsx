/**
 * Board settings page , board feel (minimap + snap). Reads/writes the shared
 * settings store through its module setters, mirroring the old SettingsPanel's
 * Board section.
 *
 * Idle recenter used to live here (a toggle + interval slider gliding the board
 * back to the Clock after inactivity). The panel-session module replaced it:
 * glide-home now happens at session end, gated by idleDimEnabled/idleDimTimeoutMs
 * on the Display page, so the old recenter settings had no reader left , see
 * Display's "Dim when idle" section for the surviving control.
 */

import {
  SNAP_MODE_LABEL,
  SNAP_MODES,
  setShowMinimap,
  setSnapMode,
  useSettings,
} from "../../../lib/settings";
import { Segmented } from "../../ui/Segmented";
import { Switch } from "../../ui/Switch";
import { RowShell, SectionCard } from "../blocks";
import type { PageProps } from "../SettingsPage";

const SNAP_OPTIONS = SNAP_MODES.map((value) => ({ value, label: SNAP_MODE_LABEL[value] }));

export function BoardPage(_props: PageProps) {
  const settings = useSettings();

  return (
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
  );
}
