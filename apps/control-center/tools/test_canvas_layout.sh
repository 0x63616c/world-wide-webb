#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
canvas_check=$(mktemp -d "${TMPDIR:-/tmp}/panel-canvas-check.XXXXXX")
trap 'rm -rf "$canvas_check"' EXIT
swiftc apple/App/Apps/PanelCanvasProfile.swift tools/test_canvas_layout.swift -o "$canvas_check/check"
"$canvas_check/check"
