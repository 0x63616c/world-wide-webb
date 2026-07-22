#!/usr/bin/env bash
# Blocks any Storybook story file that has no autodocs Docs page.
#
# WHY: a story is only "documented" when its meta enables Storybook autodocs, so
# addon-docs generates the Docs page (args table + descriptions). Without it a
# component lands in Storybook with stories but no doc surface. This is the
# mechanical invariant that keeps every component's Docs page present , mirroring
# the other blocking content guards (e.g. scripts/check-fake-data.sh).
#
# A story counts as documented if the file EITHER:
#   1. references `autodocs` directly (e.g. tags: ["autodocs"]), OR
#   2. uses a sanctioned meta factory that injects autodocs for us. Today that is
#      `defineTileMeta` (web/src/components/tiles/__stories__/factory.ts adds
#      tags: ["autodocs", ...]). Add new factory names to FACTORY_NAMES below.
#
# Usage:
#   check-storybook-docs.sh [files...]   # lefthook passes {staged_files}
#   check-storybook-docs.sh              # no args -> all tracked *.stories.tsx
#
# Shared by lefthook pre-commit (fast, staged) AND CI's test job (authoritative
# backstop, all tracked files , pre-commit is bypassable with --no-verify).

set -euo pipefail

# Meta factories known to inject `tags: ["autodocs"]`. Extend when a new one lands.
FACTORY_NAMES=(defineTileMeta)

# Build the "has a doc" regex: the literal autodocs tag, or any sanctioned factory.
DOC_RE='autodocs'
for fn in "${FACTORY_NAMES[@]}"; do
  DOC_RE="${DOC_RE}|${fn}"
done

# Collect the candidate files. With args, filter to story files (lefthook globs
# already do this, but a passed non-story is harmless to skip). Without args,
# enumerate every tracked story so CI sees exactly the committed surface.
files=()
if [ "$#" -gt 0 ]; then
  for f in "$@"; do
    case "$f" in *.stories.tsx) files+=("$f") ;; esac
  done
else
  while IFS= read -r f; do files+=("$f"); done < <(git ls-files '*.stories.tsx')
fi

if [ "${#files[@]}" -eq 0 ]; then
  echo "storybook-docs: no story files to check."
  exit 0
fi

missing=()
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  grep -Eq "$DOC_RE" "$f" || missing+=("$f")
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "✗ Storybook story without an autodocs Docs page:" >&2
  printf '   %s\n' "${missing[@]}" >&2
  echo "" >&2
  echo "Every *.stories.tsx must enable autodocs so addon-docs generates a Docs page." >&2
  echo "Fix: add  tags: [\"autodocs\"]  to the story's meta, or define it through a" >&2
  echo "sanctioned factory (e.g. defineTileMeta). See scripts/check-storybook-docs.sh." >&2
  exit 1
fi

echo "storybook-docs: all ${#files[@]} story file(s) have a Docs page."
exit 0
