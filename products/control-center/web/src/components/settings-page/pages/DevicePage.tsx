/**
 * Device settings page , identity (editable name) plus live status readouts
 * (battery, mount tilt, stable device id). Wires the shared settings/sensor
 * stores into the Concept-A section cards exactly like the old SettingsPanel's
 * Device section; carries no local state of its own.
 */

import { getDeviceId } from "../../../lib/device-id";
import { deriveDefaultName, setDeviceName, useDeviceName } from "../../../lib/device-name";
import { formatTilt } from "../../../lib/tilt";
import { formatBattery, useBatteryInfo } from "../../../lib/useBatteryInfo";
import { useTiltAngle } from "../../../lib/useTiltAngle";
import { TextInput } from "../../ui/TextInput";
import { ChevronValue, RowShell, SectionCard } from "../blocks";
import type { PageProps } from "../SettingsPage";

const VALUE_TEXT = { fontFamily: "var(--mono)", fontSize: 14, color: "var(--ink)" } as const;

export function DevicePage({ onOpenLevel }: PageProps) {
  const { name: deviceName, isSet: deviceNameSet } = useDeviceName();
  // The page only mounts while Settings is open, so both sensors run exactly
  // for that lifetime.
  const battery = useBatteryInfo(true);
  const tilt = useTiltAngle(true);

  return (
    <>
      <SectionCard title="Identity">
        {[
          // Value shows the user's chosen name (empty until they set one, so the
          // placeholder reveals the auto-derived default); clearing it reverts to
          // that default and re-raises the "set your device name" banner.
          <TextInput
            key="name"
            label="Device name"
            value={deviceNameSet ? deviceName : ""}
            placeholder={deriveDefaultName()}
            onChange={setDeviceName}
          />,
        ]}
      </SectionCard>

      <SectionCard title="Status">
        {[
          <RowShell
            key="battery"
            label="Battery"
            sub="Charge state of this panel."
            control={
              battery ? (
                <span
                  style={{
                    ...VALUE_TEXT,
                    color: battery.isCharging ? "var(--green, #7ac48f)" : "var(--ink)",
                  }}
                >
                  {formatBattery(battery)}
                </span>
              ) : (
                <span style={VALUE_TEXT}>unavailable</span>
              )
            }
          />,
          <RowShell
            key="level"
            label="Level"
            sub="Open the full screen level to adjust the mount."
            control={
              <ChevronValue
                value={tilt.state === "ready" ? formatTilt(tilt.angle) : "--"}
                onClick={onOpenLevel}
              />
            }
          />,
          <RowShell
            key="id"
            label="Device ID"
            sub="Stable identity used to tag this panel's logs."
            control={<span style={VALUE_TEXT}>{getDeviceId()}</span>}
          />,
        ]}
      </SectionCard>
    </>
  );
}
