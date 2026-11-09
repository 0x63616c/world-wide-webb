#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c 'import json; print(json.load(open("tools/versions.json"))["cargo-deny"])')
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  Linux-aarch64|Linux-arm64) target=aarch64-unknown-linux-musl ;;
  Linux-x86_64) target=x86_64-unknown-linux-musl ;;
  *) echo 'Unsupported cargo-deny host' >&2; exit 1 ;;
esac
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/world-wide-webb/cargo-deny/$version/$target"
binary="$cache_dir/cargo-deny"
if [ ! -x "$binary" ]; then
  mkdir -p "$cache_dir"
  download_dir=$(mktemp -d "$cache_dir/download.XXXXXX")
  trap 'rm -rf "$download_dir"' EXIT
  archive="cargo-deny-$version-$target.tar.gz"
  url="https://github.com/EmbarkStudios/cargo-deny/releases/download/$version/$archive"
  archive_api=''
  checksum_api=''
  # The release API serves the same upstream bytes without the browser-download
  # route, which can return504 from fresh guests. Keep checksum verification.
  if curl --fail --silent --show-error --location \
      "https://api.github.com/repos/EmbarkStudios/cargo-deny/releases/tags/$version" \
      -o "$download_dir/release.json"; then
    read -r archive_api checksum_api < <(python3 - "$download_dir/release.json" "$archive" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as source:
    assets = json.load(source)['assets']
ids = []
for name in (sys.argv[2], sys.argv[2] + '.sha256'):
    matches = [a['id'] for a in assets if a['name'] == name]
    if len(matches) != 1 or type(matches[0]) is not int or matches[0] < 1:
        raise SystemExit('Expected one exact upstream cargo-deny release asset')
    ids.append(matches[0])
print(*(f'https://api.github.com/repos/EmbarkStudios/cargo-deny/releases/assets/{identity}' for identity in ids))
PY
    )
  fi
  download_asset() {
    local api_url=$1 browser_url=$2 destination=$3
    if [[ -n "$api_url" ]] && curl --fail --silent --show-error --location \
        -H 'Accept: application/octet-stream' "$api_url" -o "$destination"; then
      return
    fi
    curl --fail --silent --show-error --location "$browser_url" -o "$destination"
  }
  download_asset "$archive_api" "$url" "$download_dir/$archive"
  download_asset "$checksum_api" "$url.sha256" "$download_dir/checksum"
  python3 - "$download_dir/$archive" "$download_dir/checksum" <<'PY'
import hashlib, sys
from pathlib import Path
archive, checksum = map(Path, sys.argv[1:])
if hashlib.sha256(archive.read_bytes()).hexdigest() != checksum.read_text().split()[0]:
    raise SystemExit('cargo-deny checksum mismatch')
PY
  tar -xzf "$download_dir/$archive" -C "$download_dir" --strip-components=1 "cargo-deny-$version-$target/cargo-deny"
  chmod 755 "$download_dir/cargo-deny"
  mv "$download_dir/cargo-deny" "$binary"
fi
"$binary" check
