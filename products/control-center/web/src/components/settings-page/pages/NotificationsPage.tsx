/**
 * Notifications settings page , three sections:
 *
 *  1. Active , the live board-wide alerts from the shared `useNotifications`
 *     store, each dismissible in place (unchanged behaviour). These are the
 *     EPHEMERAL banners, not the persistent center; an empty store renders a
 *     single "nothing active" row rather than an invented sample.
 *  2. Push notifications , an enable switch that drives the OS permission
 *     prompt + APNs token registration, plus per-category mutes.
 *  3. Quiet hours , the window during which raised notifications stay silent.
 *
 * Push support is probed once on mount: off the native shell (browser, dev,
 * Storybook) there is nothing to enable, so the switch is disabled and says so
 * rather than silently doing nothing.
 */

import { useCallback, useEffect, useState } from "react";
import { Switch, TextInput } from "@/components/ui";
import {
  CATEGORY_LABEL,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  parseClock,
  parseMutedCategories,
} from "@/lib/notifications";
import { enablePush, isPushSupported } from "@/lib/push";
import {
  setCategoryMuted,
  setPushEnabled,
  setQuietHoursEnabled,
  setQuietHoursEnd,
  setQuietHoursStart,
  useSettings,
} from "@/lib/settings";
import { trpc } from "@/lib/trpc";
import { useNotifications } from "@/lib/useNotifications";
import { ActionButton, RowShell, SectionCard } from "../blocks";

/**
 * An "HH:MM" field that keeps a local draft while typing.
 *
 * The store's setter rejects a malformed time (schema guard), so binding the
 * input straight to it would freeze the field the instant a keystroke made the
 * value transiently invalid , you could never edit "22:00" at all. The draft
 * absorbs those intermediate states and only commits once the value parses.
 */
function TimeField({
  value,
  onCommit,
  label,
}: {
  value: string;
  onCommit: (next: string) => void;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div style={{ width: 96 }}>
      <TextInput
        value={draft ?? value}
        label={label}
        placeholder="22:00"
        onChange={(next) => {
          setDraft(next);
          if (parseClock(next) !== null) onCommit(next);
        }}
      />
    </div>
  );
}

export function NotificationsPage() {
  const { notifications, clearNotification } = useNotifications();
  const settings = useSettings();
  const muted = new Set(parseMutedCategories(settings.mutedCategories));

  const registerToken = trpc.notifications.registerToken.useMutation();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    void isPushSupported().then((ok) => {
      if (!canceled) setSupported(ok);
    });
    return () => {
      canceled = true;
    };
  }, []);

  const onTogglePush = useCallback(
    (next: boolean) => {
      setPushError(null);
      if (!next) {
        // Turning it off is local-only: there is no OS API to un-request a
        // permission, and the token stays valid server-side until it's replaced.
        setPushEnabled(false);
        return;
      }
      void enablePush((input) => registerToken.mutate(input)).then((result) => {
        // Only reflect "on" once the OS actually granted , otherwise the switch
        // would claim a state the device does not have.
        setPushEnabled(result.ok);
        if (!result.ok) {
          setPushError(
            result.reason === "denied"
              ? "Permission was declined. Enable it in iOS Settings > Notifications."
              : result.reason === "unsupported"
                ? "Push is only available in the installed panel app."
                : "Couldn't register for push. Check the logs.",
          );
        }
      });
    },
    [registerToken],
  );

  const pushSub =
    supported === false
      ? "Only available in the installed panel app"
      : (pushError ?? "Alerts are delivered to this panel even when the screen is asleep");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <SectionCard title="Active">
        {notifications.length === 0
          ? [
              <RowShell
                key="empty"
                label="No active notifications"
                sub="Alerts raised on the board show up here while they're live."
                control={null}
              />,
            ]
          : notifications.map((n) => (
              <RowShell
                key={n.id}
                label={n.message}
                sub={n.detail}
                control={
                  <ActionButton onClick={() => clearNotification(n.id)}>Dismiss</ActionButton>
                }
              />
            ))}
      </SectionCard>

      <SectionCard title="Push notifications">
        {[
          <RowShell
            key="enable"
            label="Push notifications"
            sub={pushSub}
            control={
              <Switch
                checked={settings.pushEnabled}
                onChange={onTogglePush}
                disabled={supported === false}
                label="Push notifications"
              />
            }
          />,
          ...NOTIFICATION_CATEGORIES.map((category: NotificationCategory) => (
            <RowShell
              key={`mute-${category}`}
              label={`Mute ${CATEGORY_LABEL[category]}`}
              sub={`Hide ${CATEGORY_LABEL[category]} alerts from this panel's notification center`}
              control={
                <Switch
                  checked={muted.has(category)}
                  onChange={(next) => setCategoryMuted(category, next)}
                  label={`Mute ${CATEGORY_LABEL[category]}`}
                />
              }
            />
          )),
        ]}
      </SectionCard>

      <SectionCard title="Quiet hours">
        {[
          <RowShell
            key="quiet-enabled"
            label="Quiet hours"
            sub="Notifications raised inside the window stay silent"
            control={
              <Switch
                checked={settings.quietHoursEnabled}
                onChange={setQuietHoursEnabled}
                label="Quiet hours"
              />
            }
          />,
          <RowShell
            key="quiet-start"
            label="Starts"
            sub="24-hour time, e.g. 22:00"
            control={
              <TimeField
                value={settings.quietHoursStart}
                onCommit={setQuietHoursStart}
                label="Quiet hours start"
              />
            }
          />,
          <RowShell
            key="quiet-end"
            label="Ends"
            sub="Wraps past midnight when it's earlier than the start"
            control={
              <TimeField
                value={settings.quietHoursEnd}
                onCommit={setQuietHoursEnd}
                label="Quiet hours end"
              />
            }
          />,
        ]}
      </SectionCard>
    </div>
  );
}
