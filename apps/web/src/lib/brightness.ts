/** Native backlight bridge for the Expo panel shell. */

import { isNativeShell, nativeRequest } from "./native-bridge";

export function isNativeDisplay(): boolean {
  return isNativeShell();
}

async function setBacklight(level: number): Promise<void> {
  if (!isNativeDisplay()) return;
  try {
    await nativeRequest("setBrightness", { level });
  } catch {
    // Best-effort: a brightness failure must never crash the board.
  }
}

export async function dimTo(level: number): Promise<void> {
  await setBacklight(level);
}

export async function wakeTo(level: number): Promise<void> {
  await setBacklight(level);
}
