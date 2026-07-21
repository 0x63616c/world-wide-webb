/**
 * Applies the stored accent to the document root.
 *
 * A sibling of useVolumeSync: store → device (here, the DOM), one direction
 * only, no tRPC. It writes to `document.documentElement` rather than a React
 * subtree because the accent has to reach everything the panel paints ,
 * portalled modals, the board, and the `<body>` backdrop alike.
 */

import { useEffect } from "react";
import { applyAccent } from "./accent";
import { useSettings } from "./settings";

export function useAccentTheme(): void {
  const { accent } = useSettings();
  useEffect(() => {
    applyAccent(document.documentElement, accent);
  }, [accent]);
}
