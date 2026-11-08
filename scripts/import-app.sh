#!/usr/bin/env bash
# Imports an existing app repository into apps/<slug> with its full history (docs/IMPORT.md).
#   scripts/import-app.sh <owner/repo> <slug> [--branch main] [--move <path>=<dest>]...
#   scripts/import-app.sh 0x63616c/tendr tendr
#   scripts/import-app.sh owner/repo samplr --move admin=web/samplr-admin
#
# With git-filter-repo installed (brew install git-filter-repo) the imported history is rewritten
# into apps/<slug>/, so `git log -- apps/<slug>/<file>` reaches the original first commit. Without
# it, git subtree adds the history unchanged under one merge commit. --move relocates a folder
# after the import (paths are relative to the imported repository), keeping its history via git mv.
# Run on a clean working tree; it commits the import (with [skip ci]).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
repo=${1:-}
slug=${2:-}
[[ "$repo" == */* && -n "$slug" ]] || fail "usage: scripts/import-app.sh <owner/repo> <slug> [--branch main] [--move <path>=<dest>]..."
shift 2
branch="" moves=()
while (($#)); do
  case "$1" in
    --branch) branch=${2:?--branch needs a name}; shift ;;
    --move) moves+=("${2:?--move needs <path>=<dest>}"); shift ;;
    *) fail "Unknown option $1" ;;
  esac
  shift
done
[[ -z "$(git status --porcelain)" ]] || fail "Commit or stash your changes first"
[[ "$slug" =~ ^[a-z][a-z0-9-]*$ ]] || fail "Invalid app slug"
[[ ! -e "apps/$slug" ]] || fail "apps/$slug already exists"

url="${IMPORT_URL:-https://github.com/$repo.git}"
if [[ -z "${IMPORT_URL:-}" ]] && command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then url=$(gh repo view "$repo" --json url --jq .url).git; fi
[[ -n "$branch" ]] || branch=$(git ls-remote --symref "$url" HEAD | sed -n 's#^ref: refs/heads/\(.*\)\tHEAD#\1#p')
[[ -n "$branch" ]] || fail "Could not find the default branch of $repo; pass --branch"

if git filter-repo --version >/dev/null 2>&1; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  git clone --quiet --branch "$branch" "$url" "$work/repo"
  git -C "$work/repo" filter-repo --quiet --force --to-subdirectory-filter "apps/$slug"
  git fetch --quiet "$work/repo" "$branch"
  git merge --quiet --allow-unrelated-histories --no-edit -m "Import $repo into apps/$slug with history [skip ci]" FETCH_HEAD
else
  echo "git-filter-repo not found; importing with git subtree (history kept, paths not rewritten)."
  git subtree add --prefix "apps/$slug" "$url" "$branch" -m "Import $repo into apps/$slug with history [skip ci]"
fi

if ((${#moves[@]})); then
  for move in "${moves[@]}"; do
    from="apps/$slug/${move%%=*}"
    to="${move#*=}"
    [[ -e "$from" ]] || fail "--move: $from does not exist"
    mkdir -p "$(dirname "$to")"
    git mv "$from" "$to"
    echo "Moved $from to $to"
  done
  git commit --quiet -m "Move parts of $repo out of apps/$slug [skip ci]"
fi

echo "Imported $repo into apps/$slug. Next steps for wiring it into the monorepo: docs/IMPORT.md."
