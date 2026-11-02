import { useEscapeToClose } from "./escape-stack";

/** Escape and edge swipes share the topmost-surface arbiter with PIN dialogs. */
export function useBackNavigation(onBack: () => void): void {
  useEscapeToClose(true, onBack);
}
