/**
 * Notifications settings page , the live list of board-wide notifications from
 * the shared `useNotifications` store, each dismissible in place. No fixtures and
 * no quiet-hours toggle (that setting does not exist); an empty store renders a
 * single "nothing active" row rather than an invented sample.
 */

import { useNotifications } from "../../../lib/useNotifications";
import { ActionButton, RowShell, SectionCard } from "../blocks";

export function NotificationsPage() {
  const { notifications, clearNotification } = useNotifications();

  return (
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
              control={<ActionButton onClick={() => clearNotification(n.id)}>Dismiss</ActionButton>}
            />
          ))}
    </SectionCard>
  );
}
