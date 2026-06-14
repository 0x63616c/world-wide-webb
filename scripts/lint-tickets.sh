#!/usr/bin/env bash
# Advisory ticket lint , the drift backstop for docs/ticket-standards.md.
#
# We can't hook `bd create`, so this catches tickets created off-skill. It is
# NON-BLOCKING: it prints warnings and ALWAYS exits 0. Run it in a backlog scrub.
#
# Warns, per open / in_progress issue, on:
#   MISSING-AC     code ticket (bug|feature|task|chore) with no acceptance criteria
#   PROSE-AC       acceptance criteria that aren't checkbox form (no "- [ ]")
#   UNTYPED-SPIKE  title smells like a spike (evaluate/investigate/spike) but type
#                  isn't `decision` and it lacks the `spike` label
#   P0-AGING       a P0 still open longer than P0_AGE_DAYS (default 14)
#   STALLED        in_progress longer than STALL_DAYS (default 7) , likely abandoned
#
# Reads issues from `bd export`. For hermetic testing, stub `bd` on PATH (see
# scripts/test-lint-tickets.sh) and pin "now" with LINT_NOW=<epoch>.
set -euo pipefail

NOW="${LINT_NOW:-$(date +%s)}"
P0_AGE_DAYS="${P0_AGE_DAYS:-14}"
STALL_DAYS="${STALL_DAYS:-7}"

if ! command -v bd >/dev/null 2>&1; then
  echo "lint-tickets: 'bd' not on PATH; nothing to lint."
  exit 0
fi

rows="$(bd export 2>/dev/null | jq -r \
  --argjson now "$NOW" \
  --argjson p0days "$P0_AGE_DAYS" \
  --argjson stalldays "$STALL_DAYS" '
  select(.status=="open" or .status=="in_progress")
  | (.acceptance_criteria // "") as $ac
  | (.issue_type // "task") as $t
  | (.labels // []) as $labels
  | (.updated_at // .updated // "1970-01-01T00:00:00Z") as $upd
  | (($now - ($upd | fromdateiso8601)) / 86400) as $age
  | ([
      (if (($t=="bug" or $t=="feature" or $t=="task" or $t=="chore"))
          and (($ac | gsub("\\s";"")) | length) == 0
       then "MISSING-AC" else empty end),
      (if (($ac | length) > 0) and (($ac | test("- \\[")) | not)
       then "PROSE-AC" else empty end),
      (if (.title | test("evaluate|investigate|spike|adopt ";"i"))
          and ($t != "decision") and (($labels | index("spike")) == null)
       then "UNTYPED-SPIKE" else empty end),
      (if (.priority == 0) and (.status == "open") and ($age > $p0days)
       then "P0-AGING" else empty end),
      (if (.status == "in_progress") and ($age > $stalldays)
       then "STALLED" else empty end)
    ]) as $w
  | if ($w | length) > 0 then "\(.id)\t\($w | join(","))\t\(.title)" else empty end
')"

if [ -z "$rows" ]; then
  echo "lint-tickets: clean , no warnings."
  exit 0
fi

count="$(printf '%s\n' "$rows" | grep -c . || true)"
echo "lint-tickets: ${count} ticket(s) with warnings (advisory, non-blocking):"
echo
printf '%-12s %-40s %s\n' "TICKET" "WARNINGS" "TITLE"
printf '%s\n' "$rows" | while IFS=$'\t' read -r id warns title; do
  printf '%-12s %-40s %s\n' "$id" "$warns" "$title"
done
echo
echo "See docs/ticket-standards.md. Fix via /new-ticket standards; exit 0 (advisory)."
exit 0
