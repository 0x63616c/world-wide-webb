// Client-side validation, ported from docs/captive-portal/design/components.jsx.
// Messages keep the design's curly apostrophe verbatim (the PRD bans em dashes,
// not curly quotes). Validate on submit, not per keystroke; trim only here.
// Password-only since www-p9hx (no name/email landing form).

export function validatePassword(pw: string): string | null {
  if (!pw?.trim()) return "Enter the Wi-Fi password to continue.";
  if (pw.trim().length < 6) return "That password looks too short.";
  return null;
}
