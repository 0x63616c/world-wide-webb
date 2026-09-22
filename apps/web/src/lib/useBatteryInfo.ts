import { useEffect, useState } from "react";
import { isNativeShell, nativeRequest } from "./native-bridge";

const POLL_MS = 15_000;

export interface BatteryInfo {
  level: number;
  isCharging: boolean;
}

type NativeBatteryInfo = {
  batteryLevel: number | null;
  isCharging: boolean | null;
};

export function useBatteryInfo(enabled: boolean): BatteryInfo | null {
  const [info, setInfo] = useState<BatteryInfo | null>(null);

  useEffect(() => {
    if (!enabled || !isNativeShell()) return;

    let cancelled = false;

    async function read() {
      try {
        const battery = await nativeRequest<NativeBatteryInfo>("batteryInfo");
        if (cancelled) return;
        if (battery.batteryLevel == null || battery.isCharging == null) {
          setInfo(null);
          return;
        }
        setInfo({ level: battery.batteryLevel, isCharging: battery.isCharging });
      } catch {
        // Best-effort: a battery read failure must never break settings.
      }
    }

    void read();
    const timer = setInterval(read, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return info;
}

export function formatBattery(info: BatteryInfo): string {
  return `${Math.round(info.level * 100)}%`;
}
