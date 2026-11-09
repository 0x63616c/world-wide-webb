require "download_strategy"
require "json"
require "pathname"
require "open3"

record = JSON.parse(File.read(ARGV.fetch(0)))
root = Pathname(ARGV.fetch(1)).realpath
raise "Unexpected CLI version" unless record.fetch("version").match?(/\A\d+\.\d+\.\d+\z/)
raise "Unexpected artifact revision" unless record.fetch("commit").match?(/\A[0-9a-f]{40}\z/)
raise "Unexpected artifact tag" unless record.fetch("tag") == "dist/homelab/v#{record.fetch('version')}"
cache = root / "cache"
cache.mkpath
strategy = GitDownloadStrategy.new("https://github.com/0x63616c/world-wide-webb.git",
  "homelab-private-verification", record.fetch("version"), tag: record.fetch("tag"),
  revision: record.fetch("commit"), cache: cache)
raise "Homebrew must support partial Git downloads" unless strategy.clone_args.include?("--filter=blob:none")
strategy.fetch
revision, _error, status = Open3.capture3("git", "rev-parse", "HEAD", chdir: strategy.cached_location)
raise "Downloaded artifact revision differs" unless status.success? && revision.strip == record.fetch("commit")
stage = root / "stage"
stage.mkpath
Dir.chdir(stage) { strategy.stage }
puts "Fetched and staged the exact private CLI artifact"
