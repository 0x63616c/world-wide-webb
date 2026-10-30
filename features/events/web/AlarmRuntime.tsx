import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { useNow } from "@/lib/hooks";
import { isNativeShell, nativeRequest } from "@/lib/native-bridge";
import { panelSession } from "@/lib/panel-session";
import { playCue, warmAudio } from "@/lib/sound";
import { openTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import { useAlarms } from "./useAlarms";

/** One process-wide listener, mounted for BOTH the panel and the phone. */
export function AlarmRuntime() {
  const dialog = useRef<HTMLDivElement>(null);
  const query = useAlarms();
  const now = useNow();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const onSuccess = () => {
    setError(null);
    void utils.alarms.list.invalidate();
  };
  const onError = (err: { message: string }) => {
    setError(err.message);
    void utils.alarms.list.invalidate();
  };
  const snooze = trpc.alarms.snooze.useMutation({ onSuccess, onError });
  const stop = trpc.alarms.stop.useMutation({ onSuccess, onError });
  const ringing =
    query.data?.active.filter(
      (r) => r.status === "ringing" && Date.parse(r.expiresAt) > now.getTime(),
    ) ?? [];
  const ringKey = ringing.map((r) => `${r.id}:${r.version}`).join(",");
  useEffect(() => {
    const open = () => openTileDetail("tile_clock");
    window.addEventListener("control-center-open-alarms", open);
    return () => window.removeEventListener("control-center-open-alarms", open);
  }, []);
  useEffect(() => {
    window.addEventListener("pointerdown", warmAudio, { once: true });
    window.addEventListener("keydown", warmAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", warmAudio);
      window.removeEventListener("keydown", warmAudio);
    };
  }, []);
  useEffect(() => {
    if (!ringKey) return;
    const previous = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = [
        ...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
      ];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    };
    window.addEventListener("keydown", trap);
    let cancel: (() => void) | undefined;
    const ring = () => {
      panelSession.touch();
      cancel?.();
      cancel = playCue("alarmFire");
    };
    ring();
    const timer = window.setInterval(ring, 5_000);
    return () => {
      window.clearInterval(timer);
      cancel?.();
      window.removeEventListener("keydown", trap);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [ringKey]);

  // Native countdown is date-based: it keeps ticking after JS is suspended.
  // The shell owns credentials; the hosted page never receives them.
  const next = query.data?.next;
  const nativeKey = next ? JSON.stringify(next) : null;
  const loaded = query.data !== undefined;
  useEffect(() => {
    if (!loaded || !isNativeShell()) return;
    void nativeRequest("syncNextAlarm", { next: nativeKey ? JSON.parse(nativeKey) : null }).catch(
      () => {
        // Old shells have no module. Server alarms and the web ring still work.
      },
    );
  }, [loaded, nativeKey]);

  if (!ringing.length) return null;
  return createPortal(
    <div
      role="alertdialog"
      ref={dialog}
      aria-modal="true"
      aria-label="Alarm ringing"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        display: "grid",
        placeItems: "center",
        overflowY: "auto",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 620, display: "grid", gap: 28, textAlign: "center" }}>
        <div className="cap acc">Time to wake up</div>
        {ringing.map((ring) => (
          <section key={ring.id}>
            <h1 style={{ fontSize: 48, margin: "16px 0 32px" }}>{ring.label}</h1>
            {ring.lightsPending && (
              <p style={{ color: "var(--ink-2)", margin: "0 0 20px" }}>Turning on your lights…</p>
            )}
            <div style={{ display: "flex", gap: 16 }}>
              <Button
                style={{ height: 72, fontSize: 22 }}
                disabled={snooze.isPending || stop.isPending}
                onClick={() => snooze.mutate({ id: ring.id, version: ring.version })}
              >
                Snooze {ring.snoozeMinutes} min
              </Button>
              <Button
                variant="ghost"
                style={{ height: 72, fontSize: 22 }}
                disabled={snooze.isPending || stop.isPending}
                onClick={() => stop.mutate({ id: ring.id, version: ring.version })}
              >
                Stop
              </Button>
            </div>
          </section>
        ))}
        {(error || query.isError) && (
          <p role="alert" style={{ color: "var(--red)" }}>
            {error ?? "Connection lost. Reconnecting to your alarms…"}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
