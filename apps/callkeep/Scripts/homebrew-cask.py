#!/usr/bin/env python3
"""Render the cask pinned to one immutable private prebuilt Git artifact."""

import re
import sys
from pathlib import Path

version, revision, destination = sys.argv[1:]
if not re.fullmatch(r"1\.0\.[1-9]\d*", version) or not re.fullmatch(r"[0-9a-f]{40}", revision):
    raise SystemExit("Expected the Callkeep release counter and exact artifact commit")
Path(destination).write_text(
    """cask "callkeep" do
  version "%s"
  sha256 :no_check

  url "https://github.com/0x63616c/world-wide-webb.git",
      using: :git,
      tag: "dist/callkeep/v#{version}",
      revision: "%s"
  name "Callkeep"
  desc "Record microphone and computer audio with optional iCloud Drive storage"
  homepage "https://github.com/0x63616c/world-wide-webb"

  livecheck do
    skip "The verified private release pipeline updates this cask"
  end

  depends_on macos: :sequoia

  app "Callkeep.app"

  zap trash: [
    "~/Library/Preferences/co.calum.callkeep.plist",
    "~/Library/Saved Application State/co.calum.callkeep.savedState",
  ]
end
"""
    % (version, revision)
)
