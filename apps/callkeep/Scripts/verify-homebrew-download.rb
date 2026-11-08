require "download_strategy"
require "json"
require "pathname"
require "open3"

record = JSON.parse(File.read(ARGV.fetch(0)))
root = Pathname(ARGV.fetch(1)).realpath
raise "Unexpected release version" unless record.fetch("version").match?(/\A1\.0\.[1-9]\d*\z/)
raise "Unexpected artifact revision" unless record.fetch("artifact_commit").match?(/\A[0-9a-f]{40}\z/)
raise "Unexpected artifact tag" unless record.fetch("artifact_tag") == "dist/callkeep/v#{record.fetch('version')}"
cache = root / "cache"
cache.mkpath
strategy = GitDownloadStrategy.new("https://github.com/0x63616c/world-wide-webb.git",
  "callkeep-private-verification", record.fetch("version"), tag: record.fetch("artifact_tag"),
  revision: record.fetch("artifact_commit"), only_path: "Callkeep.app", cache: cache)
raise "Homebrew must support sparse partial Git downloads" unless strategy.clone_args.include?("--filter=blob:none")
strategy.fetch
revision, _error, status = Open3.capture3("git", "rev-parse", "HEAD", chdir: strategy.cached_location)
raise "Downloaded artifact revision differs" unless status.success? && revision.strip == record.fetch("artifact_commit")
stage = root / "stage"
stage.mkpath
Dir.chdir(stage) { strategy.stage }
raise "App was not staged" unless (stage / "Callkeep.app/Contents/Info.plist").file?
puts "Fetched and staged the exact private Homebrew artifact"
