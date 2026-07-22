/**
 * Debug settings page , the developer overlays (FPS meter, build badges) plus a
 * reset-to-defaults. The log viewer used to open from here as a modal; it now
 * has its own Logs page (a `fill` page in the shell), so this page keeps only
 * the overlay switches and the guarded reset.
 */

import { useState } from "react";
import {
  resetSettings,
  setShowBuildBadge,
  setShowBuildNumber,
  setShowFps,
  useSettings,
} from "../../../lib/settings";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Switch } from "../../ui/Switch";
import { ActionButton, RowShell, SectionCard } from "../blocks";

export function DebugPage() {
  const settings = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);

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
          <RowShell
            key="buildnum"
            label="Build number"
            sub="Show the App Store build number in the corner."
            control={
              <Switch
                label="Build number"
                checked={settings.showBuildNumber}
                onChange={setShowBuildNumber}
              />
            }
          />,
        ]}
      </SectionCard>

      <SectionCard title="Diagnostics">
        {[
          <RowShell
            key="reset"
            label="Reset settings"
            sub="Restore every setting on this panel to its default."
            control={<ActionButton onClick={() => setConfirmReset(true)}>Reset</ActionButton>}
          />,
        ]}
      </SectionCard>

      <ConfirmDialog
        open={confirmReset}
        title="Reset settings?"
        message="Restore every setting on this panel to its default. This cannot be undone."
        confirmLabel="Reset"
        tone="danger"
        onConfirm={() => {
          resetSettings();
          setConfirmReset(false);
        }}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}
