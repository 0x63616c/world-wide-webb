/**
 * Device settings page , identity (editable name) plus live status readouts
 * (battery, mount tilt, stable device id). Wires the shared settings/sensor
 * stores into the Concept-A section cards exactly like the old SettingsPanel's
 * Device section; carries no local state of its own.
 */

import { useCallback, useEffect, useState } from "react";
import { getDeviceId } from "../../../lib/device-id";
import { deriveDefaultName, setDeviceName, useDeviceName } from "../../../lib/device-name";
import { formatTilt } from "../../../lib/tilt";
import { formatBattery, useBatteryInfo } from "../../../lib/useBatteryInfo";
import { useTiltAngle } from "../../../lib/useTiltAngle";
import {
  type CameraPermissionState,
  type CameraProbeResult,
  cameraPermissionState,
  probeCamera,
} from "../../../lib/wake-capture";
import { TextInput } from "../../ui/TextInput";
import { ActionButton, ChevronValue, RowShell, SectionCard } from "../blocks";
import type { PageProps } from "../SettingsPage";

const VALUE_TEXT = { fontFamily: "var(--mono)", fontSize: 14, color: "var(--ink)" } as const;

/**
 * Human label for the OS camera permission. Same shape as the notifications
 * page's push-permission row: the value lives outside React (TCC prompt, iOS
 * Settings), so the page shows what the OS reports, not what the app hopes.
 */
const CAMERA_PERMISSION_LABEL: Record<CameraPermissionState, string> = {
  granted: "Granted",
  denied: "Denied , enable in iOS Settings > Control Center > Camera",
  prompt: "Not yet requested",
  unknown: "Unknown , this WebKit can't report it; use Test camera",
};

export function DevicePage({ onOpenLevel }: PageProps) {
  const { name: deviceName, isSet: deviceNameSet } = useDeviceName();
  // The page only mounts while Settings is open, so both sensors run exactly
  // for that lifetime.
  const battery = useBatteryInfo(true);
  const tilt = useTiltAngle(true);

  const [cameraPermission, setCameraPermission] = useState<CameraPermissionState | null>(null);
  const [probe, setProbe] = useState<CameraProbeResult | "running" | null>(null);

  // Re-read on mount and after every probe , the OS state changes outside
  // React (the TCC prompt, or a Settings toggle while the app is backgrounded).
  const refreshCameraPermission = useCallback(() => {
    void cameraPermissionState().then(setCameraPermission);
  }, []);

  useEffect(() => {
    refreshCameraPermission();
  }, [refreshCameraPermission]);

  const onTestCamera = useCallback(() => {
    // Re-entrancy guard in the handler (ActionButton has no disabled state):
    // a second tap mid-probe must not open a second camera stream.
    if (probe === "running") return;
    setProbe("running");
    void probeCamera().then((result) => {
      setProbe(result);
      refreshCameraPermission();
    });
  }, [probe, refreshCameraPermission]);

  const probeSub =
    probe === null
      ? "Opens the front camera once and releases it , raises the permission prompt if it was never asked."
      : probe === "running"
        ? "Opening camera…"
        : probe.ok
          ? "Camera opened. Wake photos should work."
          : `${probe.name}: ${probe.message}`;

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

      <SectionCard title="Wake camera">
        {[
          <RowShell
            key="permission"
            label="OS permission"
            control={
              <span style={VALUE_TEXT}>
                {cameraPermission ? CAMERA_PERMISSION_LABEL[cameraPermission] : "Checking…"}
              </span>
            }
          />,
          <RowShell
            key="test"
            label="Test camera"
            sub={probeSub}
            control={<ActionButton onClick={onTestCamera}>Test</ActionButton>}
          />,
        ]}
      </SectionCard>
    </>
  );
}
