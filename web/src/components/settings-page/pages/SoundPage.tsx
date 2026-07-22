/**
 * Sound settings page , the panel's output volume.
 *
 * One slider, and deliberately nothing else. There is no mute toggle because
 * the slider reaches a true 0, and no "sound effects" switch because that would
 * be a second control silencing a subset of what the slider already silences.
 * Sound categories can be split later if the panel ever gains a noise someone
 * wants to keep while muting the rest; today it does not.
 *
 * Unlike the brightness slider, this one is GATED on the native platform.
 * Brightness can render ungated because its consumer no-ops off-device, so a
 * browser slider is merely inert. Setting system volume has no web equivalent
 * at all, so an ungated slider here would look functional and do nothing ,
 * worse than saying so.
 */

import {
  clampVolume,
  MAX_VOLUME,
  MIN_VOLUME,
  setVolume,
  useDeviceSettings,
} from "../../../lib/device-settings";
import { isPanelVolumeAvailable } from "../../../lib/panel-volume";
import { Slider } from "../../ui/Slider";
import { RowShell, SectionCard, SliderRow } from "../blocks";

/**
 * The volume card, with availability passed in rather than detected, so both
 * states are reachable in Storybook (the real check is a device capability, not
 * something a story can arrange).
 */
export function VolumeSection({
  volume,
  available,
  onChange,
}: {
  volume: number;
  available: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <SectionCard title="Volume">
      {[
        <SliderRow key="volume">
          <Slider
            label="Volume"
            value={Math.round(volume * 100)}
            min={Math.round(MIN_VOLUME * 100)}
            max={Math.round(MAX_VOLUME * 100)}
            step={1}
            format={(n) => `${n}%`}
            disabled={!available}
            onChange={(pct) => onChange(clampVolume(pct / 100))}
          />
        </SliderRow>,
        ...(available
          ? []
          : [
              <RowShell
                key="unavailable"
                label="Not available on this device"
                sub="Volume can only be set from the panel itself."
                control={null}
              />,
            ]),
      ]}
    </SectionCard>
  );
}

export function SoundPage() {
  const { volume } = useDeviceSettings();
  return (
    <VolumeSection volume={volume} available={isPanelVolumeAvailable()} onChange={setVolume} />
  );
}
