/**
 * Logs settings page , the on-device log viewer. This is a `fill` page: the
 * shell hands it a definite full height and no 720px column cap, so `LogsView`'s
 * internal list can own its own scroll region and window correctly. The page
 * itself carries no data , `LogsView` reads the live log ring and IndexedDB
 * store directly.
 */

import { LogsView } from "../../logs/LogsView";

export function LogsPage() {
  return <LogsView />;
}
