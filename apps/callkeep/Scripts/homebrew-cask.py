#!/usr/bin/env python3
"""Render the cask pinned to one signed public release archive."""

import re
import sys
from pathlib import Path

version, checksum, destination = sys.argv[1:]
if not re.fullmatch(r"1\.0\.[1-9]\d*", version) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
    raise SystemExit("Expected the Callkeep release counter and archive SHA-256")
Path(destination).write_text(
    r"""cask "callkeep" do
  version "%s"
  sha256 "%s"

  url "https://github.com/0x63616c/world-wide-webb/releases/download/callkeep%%2Fv#{version}/Callkeep-#{version}.zip"
  name "Callkeep"
  desc "Record microphone and computer audio with optional iCloud Drive storage"
  homepage "https://github.com/0x63616c/world-wide-webb"

  livecheck do
    url "https://github.com/0x63616c/world-wide-webb/releases"
    regex(%%r{/releases/tag/callkeep(?:%%2F|/)v?(\d+(?:\.\d+)+)}i)
    strategy :page_match
  end

  depends_on macos: :sequoia

  app "Callkeep.app"

  zap trash: [
    "~/Library/Preferences/co.calum.callkeep.plist",
    "~/Library/Saved Application State/co.calum.callkeep.savedState",
  ]
end
"""
    % (version, checksum)
)
