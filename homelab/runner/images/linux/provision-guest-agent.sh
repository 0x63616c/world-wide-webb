#!/usr/bin/env bash
# Trusted Linux image construction only; no registered runner or job is present.
set -euo pipefail
[ "$(uname -m)" = aarch64 ]
[ "$(id -u)" = 1000 ]
[ "$HOME" = /home/admin ]
recipe=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d /tmp/homelab-agent-build.XXXXXXXX)
cleanup() {
  local result=$?
  # Go's verified module cache is read-only by default; only normalize the
  # private build directory created above, never an existing user cache.
  if ! chmod -R u+w "$work" || ! rm -rf -- "$work"; then
    result=1
  fi
  return "$result"
}
trap cleanup EXIT
curl -fL --retry 3 https://go.dev/dl/go1.27.3.linux-arm64.tar.gz -o "$work/go.tar.gz"
printf '%s  %s\n' a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49 "$work/go.tar.gz" | sha256sum --check
curl -fL --retry 3 https://codeload.github.com/openai/tart-guest-agent/tar.gz/26268c6d77d1c1059cd4a0fb88ae170c64cd2d9a -o "$work/source.tar.gz"
printf '%s  %s\n' 9e93b681f72e7c04d48c202a034698fca0fc9a395eb1f894c537ff9d6eca262e "$work/source.tar.gz" | sha256sum --check
tar -xzf "$work/go.tar.gz" -C "$work"
mkdir "$work/source"
tar -xzf "$work/source.tar.gz" --strip-components=1 -C "$work/source"
cd "$work/source"
# Idle transports leaked by Linux host exec clients must close without killing
# the agent or interrupting long-running RPCs. No upstream dependency upgrades.
patch --batch --fuzz=0 -p1 < "$recipe/guest-agent-idle.patch"
export PATH="$work/go/bin:$PATH" GOTOOLCHAIN=local CGO_ENABLED=0
export GOCACHE="$work/cache" GOMODCACHE="$work/modules" GOFLAGS=-modcacherw
go test -mod=readonly ./internal/rpc ./internal/vsock
go mod verify
go build -mod=readonly -trimpath \
  -ldflags='-s -w -X github.com/cirruslabs/tart-guest-agent/internal/version.Version=0.15.0-homelab-idle1' \
  -o "$work/tart-guest-agent" ./cmd/main.go
# Replacing the file does not stop the running bootstrap agent. The next VM boot
# starts these bytes; publication always stops the builder VM first.
# This script runs in the separate image-build unit, so restarting the RPC
# service cannot kill provisioning. The builder only retries status observations.
sudo install -d -m 0755 /usr/local/share/licenses/tart-guest-agent
sudo install -m 0444 "$work/source/LICENSE" /usr/local/share/licenses/tart-guest-agent/LICENSE
sudo install -m 0555 "$work/tart-guest-agent" /usr/local/bin/tart-guest-agent.next
sudo mv /usr/local/bin/tart-guest-agent.next /usr/local/bin/tart-guest-agent
/usr/local/bin/tart-guest-agent --version
sudo systemctl restart tart-guest-agent.service
