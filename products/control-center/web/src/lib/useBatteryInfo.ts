/**
 * Battery readout for the settings Device section, via @capacitor/device.
 *
 * Polls while `enabled` (the settings modal is open) , the wall panel sits on
 * dock power, so the interesting signal is "still charging?" rather than a
 * fast-moving percentage. In a plain browser / Storybook the plugin has no
 * native side and this resolves to null, which the row renders as unavailable.
 * Mirrors the dynamic-import pattern in app-update.ts so the Capacitor module
 * stays out of the main bundle path.
 */

import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";

const POLL_MS = 60_000;

export interface BatteryInfo {
  /** 0..1 */
  level: number;
  isCharging: boolean;
}

export function useBatteryInfo(enabled: boolean): BatteryInfo | null {
  const [info, setInfo] = useState<BatteryInfo | null>(null);

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return;

    let cancelled = false;

    async function read() {
      try {
        const { Device } = await import("@capacitor/device");
        const battery = await Device.getBatteryInfo();
        if (cancelled) return;
        if (battery.batteryLevel == null || battery.isCharging == null) return;
        setInfo({ level: battery.batteryLevel, isCharging: battery.isCharging });
      } catch {
        // Best-effort , a battery read failure must never break settings.
      }
    }

    void read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return info;
}

/** "100% · charging" / "87%" , shared by the row and its tests. */
export function formatBattery(info: BatteryInfo): string {
  const percent = Math.round(info.level * 100);
  return info.isCharging ? `${percent}% · charging` : `${percent}%`;
}
