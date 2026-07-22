import { useCallback, useSyncExternalStore } from "react";

export interface Notification {
  id: string;
  message: string;
  detail?: string;
}

type Listener = () => void;

let state: Notification[] = [];
const listeners = new Set<Listener>();

function subscribe(cb: Listener) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

function notify() {
  for (const cb of listeners) cb();
}

function raiseNotificationGlobal(n: Notification) {
  if (state.some((x) => x.id === n.id)) return;
  state = [...state, n];
  notify();
}

function clearNotificationGlobal(id: string) {
  if (!state.some((x) => x.id === id)) return;
  state = state.filter((x) => x.id !== id);
  notify();
}

/**
 * Singleton external store for board-wide notifications. Shared so the future
 * www-awm title-bar notification center can consume the same events without
 * prop-drilling.
 */
export function useNotifications() {
  const notifications = useSyncExternalStore(subscribe, getSnapshot);

  const raiseNotification = useCallback((n: Notification) => {
    raiseNotificationGlobal(n);
  }, []);

  const clearNotification = useCallback((id: string) => {
    clearNotificationGlobal(id);
  }, []);

  return { notifications, raiseNotification, clearNotification };
}
