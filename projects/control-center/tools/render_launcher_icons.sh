#!/usr/bin/env bash
# Renders the Icon Composer documents in apple/Design/LauncherIcons into PanelAssets.
# Edit a document in Icon Composer, then run this and commit both.
set -euo pipefail
cd "$(dirname "$0")/../apple"
ictool="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"
count=0
for document in Design/LauncherIcons/*.icon; do
  name="$(basename "$document" .icon)"
  set="Resources/PanelAssets.xcassets/LauncherIcon-$name.imageset"
  mkdir -p "$set"
  "$ictool" "$document" --export-image --output-file "$set/icon.png" \
    --platform iOS --rendition Default --width 512 --height 512 --scale 1 > /dev/null
  printf '{"images":[{"filename":"icon.png","idiom":"universal"}],"info":{"author":"xcode","version":1}}\n' \
    > "$set/Contents.json"
  count=$((count + 1))
done
echo "Launcher icons: rendered $count Icon Composer documents."
