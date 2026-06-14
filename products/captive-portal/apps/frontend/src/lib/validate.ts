// Client-side validation, ported 1:1 from docs/captive-portal/design/components.jsx.
// Messages keep the design's curly apostrophe verbatim (the PRD bans em dashes,
// not curly quotes). Validate on submit, not per keystroke; trim only here.

/** Permissive email check, catches obvious typos, not every RFC edge case.
 *  Real verification is the emailed code. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface LandingFormState {
  name: string;
  email: string;
  agreed: boolean;
}

export type LandingErrors = Partial<Record<keyof LandingFormState, string>>;

export function validate({ name, email, agreed }: LandingFormState): LandingErrors {
  const errs: LandingErrors = {};
  if (!name.trim()) errs.name = "Please enter your name.";
  if (!email.trim()) errs.email = "Email is required to connect.";
  else if (!EMAIL_RE.test(email.trim()))
    errs.email = "That doesn’t look like a valid email address.";
  if (!agreed) errs.agreed = "You must accept";
  return errs;
}

export function validatePassword(pw: string): string | null {
  if (!pw?.trim()) return "Enter the Wi-Fi password to continue.";
  if (pw.trim().length < 6) return "That password looks too short.";
  return null;
}
