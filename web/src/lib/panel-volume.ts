/**
 * panel-volume , the web side of the iOS PanelVolume plugin
 * (ios/App/App/PanelVolumePlugin.swift).
 *
 * Reads and writes the DEVICE's media volume, so the Settings slider moves the
 * real thing rather than an in-app gain that the hardware volume still caps.
 *
 * Native-only by nature: there is no web equivalent, and no useful fallback
 * either , a browser cannot set system volume, so pretending otherwise would
 * give the panel a slider that silently does nothing. `isPanelVolumeAvailable`
 * exists so the Settings page can say so plainly instead.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { log } from "./log/logger";

const volumeLog = log.child("panel-volume");

interface PanelVolumePlugin {
  getVolume(): Promise<{ value: number }>;
  setVolume(options: { value: number }): Promise<{ value: number }>;
  addListener(
    event: "volumeChanged",
    handler: (data: { value: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const plugin = registerPlugin<PanelVolumePlugin>("PanelVolume");

/** Whether this build can actually reach the device volume. False in a browser,
 *  Storybook, CI, and any native build predating the plugin. */
export function isPanelVolumeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("PanelVolume");
}

/** Read the device's current volume, or null where that is not possible. */
export async function getPanelVolume(): Promise<number | null> {
  if (!isPanelVolumeAvailable()) return null;
  try {
    const { value } = await plugin.getVolume();
    return value;
  } catch (err) {
    volumeLog.warn("read failed", { err: String(err) });
    return null;
  }
}

/**
 * Set the device's volume. Resolves to the volume the device actually reports
 * afterwards, or null when the write could not be attempted or was refused.
 *
 * A rejection here is expected to be rare but is not a bug in the caller: the
 * native write depends on an undocumented MPVolumeView detail that a future iOS
 * could break (see the plugin's header). Logging it is the whole point , that
 * log line is how such a breakage would ever be noticed.
 */
export async function setPanelVolume(value: number): Promise<number | null> {
  if (!isPanelVolumeAvailable()) return null;
  try {
    const result = await plugin.setVolume({ value });
    return result.value;
  } catch (err) {
    volumeLog.warn("write failed", { requested: value, err: String(err) });
    return null;
  }
}

/**
 * Subscribe to volume changes reported by the device , which in practice means
 * someone pressed the hardware buttons. Returns an unsubscribe fn (a no-op off
 * the panel).
 */
export function onPanelVolumeChanged(handler: (value: number) => void): () => void {
  if (!isPanelVolumeAvailable()) return () => {};
  let remove: (() => Promise<void>) | null = null;
  let cancelled = false;
  void plugin
    .addListener("volumeChanged", ({ value }) => handler(value))
    .then((handle) => {
      // Unsubscribed before the listener finished registering.
      if (cancelled) return void handle.remove();
      remove = handle.remove;
    })
    .catch((err) => {
      volumeLog.warn("listener registration failed", { err: String(err) });
    });
  return () => {
    cancelled = true;
    void remove?.();
  };
}
