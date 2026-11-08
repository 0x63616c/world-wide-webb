#!/usr/bin/env python3
"""Render the tap cask from the exact published release archive."""
import hashlib
from pathlib import Path
import re
import sys

version, archive, destination = sys.argv[1:]
if not re.fullmatch(r"\d+\.\d+\.\d+", version):
    raise SystemExit("Expected a stable semantic version")
checksum = hashlib.sha256(Path(archive).read_bytes()).hexdigest()
Path(destination).write_text('''cask "callkeep" do
  version "%s"
  sha256 "%s"

  url "https://github.com/0x63616c/callkeep/releases/download/v#{version}/Callkeep-#{version}.zip"
  name "Callkeep"
  desc "Record microphone and computer audio with optional iCloud Drive storage"
  homepage "https://github.com/0x63616c/callkeep"
  auto_updates true

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :sequoia

  app "Callkeep.app"

  zap trash: [
    "~/Library/Preferences/co.calum.callkeep.plist",
    "~/Library/Saved Application State/co.calum.callkeep.savedState",
  ]
end
''' % (version, checksum))
