#!/usr/bin/env bash
# Run once after this repository is renamed from `tendr` to `apps` (docs/RENAME.md, step 3).
# Points Tendr's in-app links and App Store listing at the new Pages URLs and stops mirroring
# Tendr at the site root. Old URLs keep working through the redirect repository.
# Usage: scripts/post-rename.sh [new-repo-name, default apps]
set -euo pipefail
cd "$(dirname "$0")/.."
repo=${1:-apps}
[[ "$repo" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid repository name" >&2; exit 1; }
old="https://0x63616c.github.io/tendr/"
new="https://0x63616c.github.io/$repo/tendr/"

# Tendr's original URLs had no app folder: /tendr/privacy/ becomes /apps/tendr/privacy/.
files=$(grep -rl --exclude-dir=.git -F "$old" apps/tendr || true)
for file in $files; do
  sed -i.bak "s#${old}#${new}#g" "$file" && rm -f "$file.bak"
  echo "Updated $file"
done
# Other apps were created under the old repository name: /tendr/<app>/ becomes /apps/<app>/.
for dir in apps/*/; do
  [[ "$dir" == apps/tendr/ ]] && continue
  files=$(grep -rl --exclude-dir=.git -F "$old" "$dir" || true)
  for file in $files; do
    sed -i.bak "s#${old}#https://0x63616c.github.io/$repo/#g" "$file" && rm -f "$file.bak"
    echo "Updated $file"
  done
done
rm -f site/.legacy-root
echo "Removed site/.legacy-root: the site root is now the app index."
echo "Next: commit, run scripts/publish-site.sh, and include the URL change in the next Tendr release."
