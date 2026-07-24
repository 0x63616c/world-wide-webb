/**
 * Applies the stored typeface to the document root.
 *
 * The exact shape of useAccentTheme, and for the same reason: store → DOM, one
 * direction, no tRPC. It writes to `document.documentElement` because the type
 * pair has to reach everything the panel paints , portalled modals and the
 * `<body>` backdrop included, neither of which sits under the React root.
 *
 * The FIRST paint is not this hook's job: index.html's inline boot script sets
 * the same attribute from localStorage before the bundle loads, so a kiosk
 * reload never flashes the default face. This hook owns every change after that.
 */

import { useEffect } from "react";
import { useSettings } from "./settings";
import { applyTypeface } from "./typeface";

export function useTypefaceTheme(): void {
  const { typeface } = useSettings();
  useEffect(() => {
    applyTypeface(document.documentElement, typeface);
  }, [typeface]);
}
