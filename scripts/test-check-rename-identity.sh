#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

git init -q "$tmpdir/repo"
cd "$tmpdir/repo"

cat > package.json <<'JSON'
{"name":"control-center"}
JSON
git add package.json

mkdir -p scripts
cp "$OLDPWD/scripts/check-rename-identity.py" scripts/check-rename-identity.py

cat > empty.tsv <<'TSV'
# category	path_regex	line_regex	reason
TSV

if python3 scripts/check-rename-identity.py --allowlist empty.tsv >/tmp/check-rename-empty.out 2>&1; then
  echo "expected audit to fail when control-center is unclassified" >&2
  exit 1
fi

cat > allow.tsv <<'TSV'
repo-platform-identity	^package\.json$	.*\bcontrol-center\b.*	Test repo package name is explicitly classified.
TSV

python3 scripts/check-rename-identity.py --allowlist allow.tsv >/tmp/check-rename-allowed.out
