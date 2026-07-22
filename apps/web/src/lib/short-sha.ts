/**
 * One shape for every git SHA the panel renders. Display is always
 * `#<7 chars>`: seven is the length git itself abbreviates to, and the `#`
 * marks it as a commit reference rather than a random hex blob. Log payloads
 * keep the bare short sha (a field value, not a label), so use `shortSha` there
 * and `formatSha` for anything a human reads on screen.
 */
export const SHORT_SHA_LEN = 7;

/** Bare abbreviated sha, no marker. For log fields and keys. */
export function shortSha(hash: string): string {
  return hash.slice(0, SHORT_SHA_LEN);
}

/** Display form: `#abc1234`. Empty in, empty out, so callers can render blanks. */
export function formatSha(hash: string): string {
  return hash ? `#${shortSha(hash)}` : "";
}
