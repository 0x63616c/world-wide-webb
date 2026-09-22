import { createFileRoute } from "@tanstack/react-router";
import { Board } from "@/components/Board";
import { MobileBoard } from "@/components/MobileBoard";
import { useIsMobile } from "@/lib/mobile";

/**
 * The one screen this app has , the fixed wall-panel board, or the phone
 * view when the same bundle is opened on an iPhone (see lib/mobile.ts for what
 * counts as a phone, and MobileBoard.tsx for why a phone gets its own screen
 * rather than a shrunken board).
 *
 * A route-level switch, not a branch inside Board: the two views share no
 * layout or chrome, and Board mounts the idle-dim session and a banner stack
 * that the phone view must never start.
 * Choosing here keeps all of that unmounted on a phone.
 */
function HomeScreen() {
  return useIsMobile() ? <MobileBoard /> : <Board />;
}

export const Route = createFileRoute("/")({
  component: HomeScreen,
});
