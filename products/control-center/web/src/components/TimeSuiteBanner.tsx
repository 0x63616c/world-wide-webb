/**
 * TimeSuiteBanner , board-level surface for a done timer or a firing alarm,
 * following the DeviceNameBanner/AppUpdateBanner precedent: raises into the
 * shared notifications store AND renders NotificationBanner rows in the
 * top-right stack.
 *
 * Mounting this from Board is ALSO what boots the time suite: its module
 * imports the stores, so app start evaluates them (deploy-reload boot-resume
 * runs with the clock page closed , no render-null runner needed).
 *
 * Interaction diverges from the other banners on purpose: their uniform tap
 * opens the Notification Center, but a ringing timer/alarm deep-links to the
 * clock detail on its own variant, with an inline Stop that silences without
 * navigating. Hidden while the clock detail is already open on the matching
 * variant (the page itself shows the ringing state; the VariantSwitcher badge
 * covers the other-variant case).
 */

import { useEffect } from "react";
import { openTileDetail, useTileDetail } from "../lib/tile-detail-store";
import { dismissAlarmFiring, useAlarmFiring, useAlarms } from "../lib/time-suite/alarm-store";
import { formatAlarmTime, formatDurationLabel } from "../lib/time-suite/pure";
import { stopTimerRinging, useTimers } from "../lib/time-suite/timer-store";
import { useNotifications } from "../lib/useNotifications";
import { NotificationBanner } from "./ui/NotificationBanner";

const CLOCK_TILE = "tile_clock";
const TIMER_NOTIF_ID = "time-suite-timer";
const ALARM_NOTIF_ID = "time-suite-alarm";

export function TimeSuiteBanner() {
  const timers = useTimers();
  const alarms = useAlarms();
  const firing = useAlarmFiring();
  const detail = useTileDetail();
  const { raiseNotification, clearNotification } = useNotifications();

  // The variant the open clock page is SHOWING. openTileDetail seeds the slug
  // and the VariantSwitcher writes every in-page hop back to the store
  // (TileDetailHost's onSelect), so this tracks the live variant; "timer" is
  // the clock entry's defaultSlug for a plain board-tap open with no slug.
  const clockVariantOpen = detail?.tileId === CLOCK_TILE ? (detail.variantSlug ?? "timer") : null;

  const doneTimer = timers.find((t) => t.state === "done" && !t.dismissedCue) ?? null;
  const firingAlarm =
    firing !== null ? (alarms.find((a) => a.id === firing.alarmId) ?? null) : null;

  const timerVisible = doneTimer !== null && clockVariantOpen !== "timer";
  const alarmVisible = firing !== null && clockVariantOpen !== "alarm";

  const timerMessage = doneTimer
    ? `Timer done — ${doneTimer.label ?? formatDurationLabel(doneTimer.durationMs)}`
    : null;
  const alarmMessage =
    firing !== null
      ? `Alarm — ${firingAlarm !== null ? formatAlarmTime(firingAlarm.hour, firingAlarm.minute) : "ringing"}`
      : null;

  // Same notification-center seam as the sibling banners (the www-awm title-bar
  // + notification-center ticket): the Notification Center lists whatever is
  // ringing. Primitive deps keep the effects' lists exact. The
  // raise branch returns a cleanup , raiseNotification no-ops on an existing
  // id, so a CHANGED message (a different done timer/alarm surfacing) must
  // clear the stale row first (the cleanup runs before the re-raise), and the
  // same cleanup removes the row on unmount.
  useEffect(() => {
    if (timerVisible && timerMessage !== null) {
      raiseNotification({ id: TIMER_NOTIF_ID, message: timerMessage });
      return () => clearNotification(TIMER_NOTIF_ID);
    }
    clearNotification(TIMER_NOTIF_ID);
  }, [timerVisible, timerMessage, raiseNotification, clearNotification]);

  useEffect(() => {
    if (alarmVisible && alarmMessage !== null) {
      raiseNotification({ id: ALARM_NOTIF_ID, message: alarmMessage });
      return () => clearNotification(ALARM_NOTIF_ID);
    }
    clearNotification(ALARM_NOTIF_ID);
  }, [alarmVisible, alarmMessage, raiseNotification, clearNotification]);

  return (
    <>
      {alarmVisible && alarmMessage !== null && (
        <TimeSuiteBannerView
          tone="red"
          role="alert"
          ariaLive="assertive"
          message={alarmMessage}
          onStop={dismissAlarmFiring}
          onOpen={() => openTileDetail(CLOCK_TILE, "alarm")}
        />
      )}
      {timerVisible && doneTimer !== null && timerMessage !== null && (
        <TimeSuiteBannerView
          tone="amber"
          message={timerMessage}
          onStop={() => stopTimerRinging(doneTimer.id)}
          onOpen={() => openTileDetail(CLOCK_TILE, "timer")}
        />
      )}
    </>
  );
}

/** @public , the view's story surface (TimeSuiteBanner.stories.tsx types its args off it). */
export interface TimeSuiteBannerViewProps {
  tone: "red" | "amber";
  message: string;
  /** Silence the ringing without navigating. */
  onStop: () => void;
  /** Open the clock detail on the matching variant. */
  onOpen: () => void;
  role?: "status" | "alert";
  ariaLive?: "polite" | "assertive";
}

/** Presentational banner, exported for Storybook. */
export function TimeSuiteBannerView({
  tone,
  message,
  onStop,
  onOpen,
  role,
  ariaLive,
}: TimeSuiteBannerViewProps) {
  // NotificationBanner's own (bubble-phase) tap uniformly opens the
  // Notification Center; this banner instead deep-links to the clock detail.
  // The capture-phase wrapper claims the tap first: stopPropagation here keeps
  // the event from ever reaching the banner's handler. Stop-button CLICKS are
  // let through untouched , the button's own onClick stops propagation itself.
  // Stop-button KEYDOWNS cannot be: the keydown itself (not the synthesized
  // click) would bubble to the banner's onKeyDown and open the Notification
  // Center, so the capture handler consumes it and invokes onStop directly.
  const isStopTap = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && target.closest("[data-stop-button]") !== null;

  return (
    <div
      onClickCapture={(e) => {
        if (isStopTap(e.target)) return;
        e.stopPropagation();
        onOpen();
      }}
      onKeyDownCapture={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.stopPropagation();
        e.preventDefault();
        if (isStopTap(e.target)) {
          onStop();
        } else {
          onOpen();
        }
      }}
    >
      <NotificationBanner tone={tone} role={role} ariaLive={ariaLive}>
        {message}
        <button
          type="button"
          data-stop-button
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          style={{
            marginLeft: 12,
            // Hit-area law: the one control that silences a ringing alarm/timer
            // gets the full 44px target; the banner row grows to fit.
            minHeight: 44,
            padding: "6px 18px",
            borderRadius: 8,
            border: "1px solid currentcolor",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Stop
        </button>
      </NotificationBanner>
    </div>
  );
}
