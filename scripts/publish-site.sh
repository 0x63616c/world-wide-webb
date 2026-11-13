#!/usr/bin/env bash
# Publish Tendr's verified static assets; infrastructure owns DNS and Worker routes.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
prepared=${1:?usage: publish-site.sh <verified-public-site-directory>}
prepared=$(cd "$prepared" && pwd -P)
: "${CLOUDFLARE_API_TOKEN:?Cloudflare deployment token is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?Cloudflare account is required}"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
"$root/scripts/build-site.sh" "$staging"
diff -qr "$staging" "$prepared" > /dev/null || {
  echo 'Prepared site differs from verified source' >&2
  exit 1
}
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["wrangler"])' "$root/projects/tendr/site-tool-versions.json")
export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false WRANGLER_SEND_METRICS=false
bunx "wrangler@$version" deploy --config "$root/projects/tendr/site.wrangler.jsonc" --assets "$prepared/tendr"
echo 'Published Tendr assets; canonical URL: https://tendr.worldwidewebb.co/'
