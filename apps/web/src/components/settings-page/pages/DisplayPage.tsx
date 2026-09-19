/**
 * Display settings page , the accent colour and the clean-screen launcher.
 *
 * Brightness, idle dimming and the typeface picker used to live here. All three
 * are constants now (see lib/settings.ts's IDLE_DIM_* and the single SF Pro
 * profile in styles/tokens.css): nobody ever moved them off their defaults, and
 * a wall panel that can be configured into never dimming is a worse panel.
 */

import { setAccent, useSettings } from "../../../lib/settings";
import { AccentPicker } from "../AccentPicker";
import { ActionButton, RowShell, SectionCard } from "../blocks";
import type { PageProps } from "../SettingsPage";

export function DisplayPage({ onOpenClean }: PageProps) {
  const settings = useSettings();

  return (
    <>
      <SectionCard title="Accent">
        {[
          <RowShell
            key="accent"
            label="Accent colour"
            sub="The highlight colour used across the board."
            control={<AccentPicker value={settings.accent} onChange={setAccent} />}
          />,
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
