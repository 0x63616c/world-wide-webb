import { useEffect, useRef, useState } from "react";
import { isNativeShell } from "@/lib/native-bridge";

declare global {
  interface Window {
    __CONTROL_CENTER_SET_ALARM_OWNER__?: (native: boolean) => Promise<boolean>;
  }
}

/** Opt-in handoff for the native Panel shell. Expo and browsers remain web-owned.
 * The promise resolves after passive effect cleanup, including AlarmRuntime's
 * active sound cue and repeat timer. The shell must await it before scheduling.
 */
export function useNativeAlarmOwner() {
  const [owner, setOwner] = useState({ native: false, revision: 0 });
  const sequence = useRef(0);
  const pending = useRef<{ revision: number; resolve: (accepted: boolean) => void } | null>(null);

  useEffect(() => {
    if (!isNativeShell()) return;
    const handoff = (native: boolean): Promise<boolean> => {
      if (typeof native !== "boolean") return Promise.resolve(false);
      pending.current?.resolve(false);
      return new Promise((resolve) => {
        const revision = ++sequence.current;
        pending.current = { revision, resolve };
        setOwner({ native, revision });
      });
    };
    window.__CONTROL_CENTER_SET_ALARM_OWNER__ = handoff;
    return () => {
      if (window.__CONTROL_CENTER_SET_ALARM_OWNER__ === handoff) {
        delete window.__CONTROL_CENTER_SET_ALARM_OWNER__;
      }
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);

  useEffect(() => {
    // React runs all old passive effect cleanups before any new effect setup.
    // Including revision makes repeated requests acknowledge even when ownership
    // stays the same (e.g. reconnecting after a lost bridge response).
    if (owner.revision === 0 || pending.current?.revision !== owner.revision) return;
    pending.current.resolve(true);
    pending.current = null;
  }, [owner]);

  return owner.native;
}
