/**
 * Fuzzy matching for the log search box.
 *
 * Deliberately only a little fuzzy. A subsequence match on its own ("does every
 * character of the query appear in order somewhere?") is far too loose on log
 * text: searching `tesla` would happily match `... "type":"query","path":"media
 * .sonosFavorites" ... ms:1234 ...` by scavenging letters across half the line.
 * On a wall panel that is worse than useless , it looks like it found something.
 *
 * So the match is constrained two ways:
 *
 *   1. A substring hit always wins, and wins first. Typing `tesla.get` or `502`
 *      behaves exactly like it did before, which is what you want 90% of the time.
 *   2. Otherwise, the query must appear as a subsequence AND be reasonably
 *      compact , the span it matched across can be at most MAX_SPREAD times the
 *      query length. That is what lets `tslget` find `tesla.get` (typo, dropped
 *      letters) while refusing to let `tesla` scavenge five letters from a
 *      50-character JSON blob.
 *
 * Space-separated terms are ANDed, so `tesla 503` finds the line that is both.
 */

/** How far a subsequence match may spread, as a multiple of the query length. */
const MAX_SPREAD = 3;

/**
 * Does `query` fuzzily occur in `text`? Both are matched case-insensitively.
 * An empty query matches everything.
 */
export function fuzzyMatch(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => matchTerm(haystack, term));
}

function matchTerm(haystack: string, term: string): boolean {
  // Fast path, and the strict one: a literal substring.
  if (haystack.includes(term)) return true;
  // Single characters would match nearly anything as a subsequence; a substring
  // miss is a real miss.
  if (term.length < 2) return false;
  return subsequenceWithinSpread(haystack, term);
}

/**
 * Scan for the query as a subsequence, restarting from each candidate first
 * character so we find the TIGHTEST match, not merely the earliest one. Without
 * the restart, one stray early character would anchor the match and stretch its
 * span across the whole line, and the compactness check would reject a match
 * that genuinely exists later on.
 */
function subsequenceWithinSpread(haystack: string, term: string): boolean {
  const maxSpan = term.length * MAX_SPREAD;

  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== term[0]) continue;

    let t = 1;
    let i = start + 1;
    while (i < haystack.length && t < term.length) {
      if (i - start >= maxSpan) break;
      if (haystack[i] === term[t]) t += 1;
      i += 1;
    }
    if (t === term.length && i - start <= maxSpan) return true;
  }
  return false;
}
