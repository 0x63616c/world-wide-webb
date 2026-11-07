#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tools_dir="${RUNNER_TEMP:?GitHub runner temp directory required}/www-linters"
mkdir -p "$tools_dir"
read -r ruff_version actionlint_version shellcheck_version < <(python3 - <<'PY'
import json
v=json.load(open('tools/versions.json'))
print(v['ruff'],v['actionlint'],v['shellcheck'])
PY
)
python3 -m venv "$tools_dir/python"
"$tools_dir/python/bin/pip" install --disable-pip-version-check "ruff==$ruff_version"
curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v$actionlint_version/actionlint_${actionlint_version}_linux_amd64.tar.gz" \
  | tar -xz -C "$tools_dir" actionlint
curl -fsSL "https://github.com/koalaman/shellcheck/releases/download/v$shellcheck_version/shellcheck-v$shellcheck_version.linux.x86_64.tar.xz" \
  | tar -xJ -C "$tools_dir" --strip-components=1 "shellcheck-v$shellcheck_version/shellcheck"
echo "$tools_dir" >> "$GITHUB_PATH"
echo "$tools_dir/python/bin" >> "$GITHUB_PATH"
