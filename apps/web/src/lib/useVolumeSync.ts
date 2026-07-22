/**
 * useVolumeSync , keeps the stored volume and the actual device volume equal,
 * whichever end changed.
 *
 *  - Store → device: the stored value is applied on mount (so a panel comes back
 *    from a reboot or reinstall at the volume someone chose) and on every later
 *    change, throttled so a slider drag isn't a native write per frame.
 *  - Device → store: the plugin's KVO listener reports hardware button presses,
 *    which are adopted as the new preference (setVolumeFromDevice).
 *
 * The two directions do not chase each other, and deliberately not by tracking
 * which end wrote last: after a store→device write the device reports back the
 * value just set, and `setVolumeFromDevice` folds into the store's ordinary
 * equality check, which drops it. The one case that is NOT a no-op is
 * quantisation , iOS snaps volume to 16 steps, so setting 0.42 reports back
 * 0.4375. That lands in the store and the slider settles onto the value the
 * device really holds, which is the honest thing to show.
 *
 * Mount ONCE, inside the providers (see app.tsx).
 */

import { useEffect, useRef } from "react";
import { setVolumeFromDevice, useDeviceSettings } from "./device-settings";
import { onPanelVolumeChanged, setPanelVolume } from "./panel-volume";

/** A native write is cheap local IPC, but each one arms a verification read, so
 *  a 60fps drag would queue a lot of pointless work. */
const WRITE_THROTTLE_MS = 150;

export function useVolumeSync(): void {
  const { volume } = useDeviceSettings();

  // Device → store. Registered once; the handler only ever calls a module-level
  // setter, so it needs no dependencies and cannot go stale.
  useEffect(() => onPanelVolumeChanged(setVolumeFromDevice), []);

  // Store → device, throttled with a leading and trailing edge so the first move
  // is instant and the final resting value is never dropped.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  const lastSent = useRef<number | null>(null);

  useEffect(() => {
    pending.current = volume;
    if (timer.current !== null) return;
    if (lastSent.current === volume) return;

    void setPanelVolume(volume);
    lastSent.current = volume;

    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current !== null && pending.current !== lastSent.current) {
        void setPanelVolume(pending.current);
        lastSent.current = pending.current;
      }
      pending.current = null;
    }, WRITE_THROTTLE_MS);
  }, [volume]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
}
