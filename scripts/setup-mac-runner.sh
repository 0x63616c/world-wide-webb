#!/usr/bin/env bash
# Optional legacy setup for self-hosted GitHub Actions runners on an Apple silicon Mac (for example
# the Mac mini), for the apps repository.
#
#   scripts/setup-mac-runner.sh [options] OWNER/REPO [OWNER/REPO ...]
#   scripts/setup-mac-runner.sh --use 0x63616c/apps
#
# Repositories on a personal account cannot share a runner, so this registers one runner per
# repository, each in its own directory under ~/actions-runners and each running as its own
# launchd service. (To share one runner, move the repositories into an organization and register
# a single organization runner instead.) Runners get the labels self-hosted, macOS, ARM64 and xcode.
#
# Options:
#   --use                  also set the repository variables MACOS_RUNNER and DEVELOPER_DIR, so the
#                          workflows switch from GitHub-hosted macos-15 to this Mac
#   --install-ios-runtime  download the iOS simulator runtime if none is installed (several GB)
#   --replace              re-register runners that are already configured here
#   --root DIR             where runner directories live (default ~/actions-runners)
#
# Registration tokens come from the local GitHub CLI login (`gh auth login`); the account needs
# admin access to each repository. Re-running is safe: configured runners are left as they are.
# This repository now pins hosted xcode-27 / Xcode 27.1; --use variables do not affect its CI.
set -euo pipefail

root="$HOME/actions-runners"
labels="xcode"
use=false install_runtime=false replace=false
repos=()
while (($#)); do
  case "$1" in
    --use) use=true ;;
    --install-ios-runtime) install_runtime=true ;;
    --replace) replace=true ;;
    --root) root=${2:?--root needs a directory}; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "Unknown option $1" >&2; exit 64 ;;
    *) repos+=("$1") ;;
  esac
  shift
done
((${#repos[@]})) || { sed -n '2,24p' "$0"; exit 64; }

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail "This script is for Apple silicon Macs."
((EUID != 0)) || fail "Run as your normal user, not root (the runner refuses to run as root)."
command -v gh >/dev/null || fail "Install the GitHub CLI first: brew install gh"
gh auth status >/dev/null 2>&1 || fail "Log in to GitHub first: gh auth login"
for repo in "${repos[@]}"; do
  [[ "$repo" == */* ]] || fail "Repositories look like OWNER/REPO, got '$repo'."
  [[ "$(gh api "repos/$repo" --jq .permissions.admin)" == true ]] || fail "Your gh login needs admin access to $repo."
done

step "Xcode"
developer_dir=$(xcode-select -p)
[[ "$developer_dir" == *.app/Contents/Developer ]] || fail "xcode-select points at $developer_dir. Install Xcode, then: sudo xcode-select -s /Applications/Xcode.app"
xcodebuild -version
if ! xcodebuild -license check >/dev/null 2>&1; then
  echo "Accepting the Xcode licence (needs your password)…"
  sudo xcodebuild -license accept
fi
echo "Running first-launch tasks (needs your password)…"
sudo xcodebuild -runFirstLaunch
if ! xcrun simctl list runtimes available | grep -q '^iOS '; then
  if $install_runtime; then
    xcodebuild -downloadPlatform iOS
  else
    echo "warning: no iOS simulator runtime is installed. Rerun with --install-ios-runtime, or install one in Xcode > Settings > Components." >&2
  fi
fi
xcrun simctl list runtimes available | grep '^iOS ' || true

step "Tool cache for ruby/setup-ruby"
# Prebuilt Rubies only work from the same path as on GitHub-hosted runners.
tool_cache=/Users/runner/hostedtoolcache
if [[ ! -w "$tool_cache" ]]; then
  sudo mkdir -p "$tool_cache"
  sudo chown -R "$(id -un)" "$tool_cache"
fi
echo "$tool_cache"

step "Runner download"
tag=$(gh api repos/actions/runner/releases/latest --jq .tag_name)
version=${tag#v}
archive="actions-runner-osx-arm64-$version.tar.gz"
mkdir -p "$root/.downloads"
if [[ ! -f "$root/.downloads/$archive" ]]; then
  curl -fL --retry 3 -o "$root/.downloads/$archive.partial" "https://github.com/actions/runner/releases/download/$tag/$archive"
  expected=$(gh api "repos/actions/runner/releases/tags/$tag" --jq .body | sed -n 's/.*<!-- BEGIN SHA osx-arm64 -->\([0-9a-f]*\)<!-- END SHA osx-arm64 -->.*/\1/p')
  actual=$(shasum -a 256 "$root/.downloads/$archive.partial" | cut -d' ' -f1)
  [[ -n "$expected" ]] || fail "Could not find the published SHA-256 for $archive."
  [[ "$expected" == "$actual" ]] || fail "SHA-256 mismatch for $archive."
  mv "$root/.downloads/$archive.partial" "$root/.downloads/$archive"
fi
echo "actions-runner $version (osx-arm64), checksum verified"

host=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
for repo in "${repos[@]}"; do
  step "Runner for $repo"
  dir="$root/${repo//\//-}"
  name="$host-${repo#*/}"
  mkdir -p "$dir"
  cd "$dir"
  if [[ -f .runner ]] && $replace; then
    ./svc.sh stop >/dev/null 2>&1 || true
    ./svc.sh uninstall >/dev/null 2>&1 || true
    ./config.sh remove --token "$(gh api -X POST "repos/$repo/actions/runners/remove-token" --jq .token)"
  fi
  if [[ -f .runner ]]; then
    echo "Already registered in $dir; leaving it as is (use --replace to re-register)."
  else
    tar xzf "$root/.downloads/$archive"
    ./config.sh --unattended --replace \
      --url "https://github.com/$repo" \
      --token "$(gh api -X POST "repos/$repo/actions/runners/registration-token" --jq .token)" \
      --name "$name" --labels "$labels" --work _work
  fi
  touch .env
  for variable in "RUNNER_TOOL_CACHE=$tool_cache" "AGENT_TOOLSDIRECTORY=$tool_cache"; do
    grep -q "^${variable%%=*}=" .env || echo "$variable" >> .env
  done
  if ./svc.sh status 2>/dev/null | grep -qi 'not installed'; then ./svc.sh install; fi
  ./svc.sh start >/dev/null 2>&1 || true
  ./svc.sh status | sed -n '1,4p'

  if $use; then
    gh variable set MACOS_RUNNER --repo "$repo" --body '["self-hosted","macOS","ARM64","xcode"]'
    gh variable set DEVELOPER_DIR --repo "$repo" --body "$developer_dir"
  fi
done

step "Result"
for repo in "${repos[@]}"; do
  echo "$repo"
  gh api "repos/$repo/actions/runners" --jq '.runners[] | "  \(.name)  \(.status)  [\([.labels[].name] | join(", "))]"'
  if $use; then
    echo "  MACOS_RUNNER=$(gh variable get MACOS_RUNNER --repo "$repo")  DEVELOPER_DIR=$(gh variable get DEVELOPER_DIR --repo "$repo")"
  else
    echo "  To switch its macOS jobs to this Mac:"
    echo "    gh variable set MACOS_RUNNER --repo $repo --body '[\"self-hosted\",\"macOS\",\"ARM64\",\"xcode\"]'"
    echo "    gh variable set DEVELOPER_DIR --repo $repo --body '$developer_dir'"
  fi
done
echo
echo "The services are launchd agents: they run while $(id -un) is logged in, so turn on automatic"
echo "login (System Settings > Users & Groups) and disable sleep for an always-on Mac mini."
