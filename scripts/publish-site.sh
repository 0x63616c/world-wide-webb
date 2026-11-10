#!/usr/bin/env bash
# Publish generated static files to a separate legacy Pages checkout, never source history.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
target=${1:?usage: publish-site.sh <clean-legacy-gh-pages-checkout>}
target=$(cd "$target" && pwd -P)
[[ "$target" != "$root" ]] || { echo 'Use a separate Pages checkout' >&2; exit 1; }
expected_remote=${SITE_PUBLISH_REMOTE:?Legacy apps host retired; configure a destination explicitly (Tendr hosting: WWW issue 1007)}
actual_remote=$(git -C "$target" remote get-url origin)
[[ "${actual_remote%.git}" == "${expected_remote%.git}" ]] || { echo 'Unexpected Pages authority' >&2; exit 1; }
[[ "$(git -C "$target" branch --show-current)" == gh-pages ]] || { echo 'Pages checkout must use gh-pages' >&2; exit 1; }
[[ -z "$(git -C "$target" status --porcelain)" ]] || { echo 'Pages checkout must be clean' >&2; exit 1; }
git -C "$target" fetch -q origin gh-pages
git -C "$target" merge -q --ff-only origin/gh-pages
[[ "$(git -C "$target" rev-parse HEAD)" == "$(git -C "$target" rev-parse origin/gh-pages)" ]] || {
  echo 'Unconfirmed local publication; retry with a fresh clean Pages checkout' >&2; exit 1;
}
src=$(git -C "$root" rev-parse HEAD)
last_message=$(git -C "$target" log -1 --format=%s)
if [[ "$last_message" =~ ^chore\(site\):\ publish\ from\ ([0-9a-f]{40})\ \[skip\ ci\]$ ]]; then
  previous_source=${BASH_REMATCH[1]}
  if [[ "$previous_source" != "$src" ]]; then
    if git -C "$root" merge-base --is-ancestor "$src" "$previous_source"; then
      echo 'Newer public site already published; keeping its authority'
      exit 0
    fi
    git -C "$root" merge-base --is-ancestor "$previous_source" "$src" || {
      echo 'Cannot establish forward site-source ancestry' >&2; exit 1;
    }
  fi
fi
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
"$root/scripts/build-site.sh" "$staging"
if [[ -n "${2:-}" ]]; then
  # Static assembly must match the tested artifact exactly, including absence of extra files.
  diff -qr "$staging" "$2" >/dev/null || { echo 'Prepared site differs from verified source' >&2; exit 1; }
fi
if [[ -f "$root/sites/.retain" ]]; then
  while IFS= read -r name || [[ -n "$name" ]]; do
    [[ -z "$name" || "$name" == \#* ]] && continue
    [[ "$name" =~ ^[a-z][a-z0-9-]*$ ]] || { echo 'Invalid retained site' >&2; exit 1; }
    if [[ ! -e "$staging/$name" && ! -L "$staging/$name" ]] &&
      [[ "$(git -C "$target" cat-file -t "HEAD:$name" 2>/dev/null || true)" == tree ]]; then
      git -C "$target" archive HEAD "$name" | tar -x -C "$staging"
    fi
  done < "$root/sites/.retain"
fi
git -C "$target" rm -rqf .
cp -R "$staging/." "$target/"
git -C "$target" add -A
message="chore(site): publish from $src [skip ci]"
if git -C "$target" diff --cached --quiet && [[ "$last_message" == "$message" ]]; then
  echo 'gh-pages already up to date'; exit 0
fi
# An identical newer payload still advances authority, preventing delayed intermediate rollback.
git -C "$target" commit -q --allow-empty -m "$message"
# No force/rebase: a competing publisher must be reconciled through a fresh clean checkout.
git -C "$target" push -q origin HEAD:gh-pages
echo "Published site from $src to legacy gh-pages"
