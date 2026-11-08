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
  curl --fail --silent --show-error --location "$url" -o "$download_dir/$archive"
  curl --fail --silent --show-error --location "$url.sha256" -o "$download_dir/checksum"
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
