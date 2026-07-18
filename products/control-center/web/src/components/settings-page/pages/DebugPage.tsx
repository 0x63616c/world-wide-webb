/**
 * Debug settings page , the developer overlays (FPS meter, build badge) plus the
 * diagnostics affordances that were the old SettingsPanel footer: the log viewer
 * and a reset-to-defaults. Overlay switches write the shared settings store; the
 * page owns the LogsModal open state exactly as SettingsPanel did.
 */

import { useState } from "react";
import { resetSettings, setShowBuildBadge, setShowFps, useSettings } from "../../../lib/settings";
import { LogsModal } from "../../LogsModal";
import { Switch } from "../../ui/Switch";
import { ActionButton, RowShell, SectionCard } from "../blocks";

export function DebugPage() {
  const settings = useSettings();
  const [logsOpen, setLogsOpen] = useState(false);

  return (
    <>
      <SectionCard title="Overlays">
        {[
          <RowShell
            key="fps"
            label="FPS meter"
            sub="Show a live frame-rate readout on the board."
            control={<Switch label="FPS meter" checked={settings.showFps} onChange={setShowFps} />}
          />,
          <RowShell
            key="badge"
            label="Build badge"
            sub="Show the running git SHA in the corner."
            control={
              <Switch
                label="Build badge"
                checked={settings.showBuildBadge}
                onChange={setShowBuildBadge}
              />
            }
          />,
        ]}
      </SectionCard>

      <SectionCard title="Diagnostics">
        {[
          <RowShell
            key="logs"
            label="View logs"
            sub="Open the on-device log viewer , the only window into the running app."
            control={<ActionButton onClick={() => setLogsOpen(true)}>View logs</ActionButton>}
          />,
          <RowShell
            key="reset"
            label="Reset settings"
            sub="Restore every setting on this panel to its default."
            control={<ActionButton onClick={resetSettings}>Reset</ActionButton>}
          />,
        ]}
      </SectionCard>

      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
    </>
  );
}
