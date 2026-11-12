require "open3"
require "json"
require_relative "release-pipeline"

module ReleaseSource
  ROOT = File.expand_path("..", __dir__)

  def self.current!(app, source)
    output, error, status =
      Open3.capture3(
        "python3",
        File.join(__dir__, "release-source.py"),
        app,
        source,
        chdir: ROOT
      )
    raise "Cannot verify latest release source: #{error}" unless status.success?
    result = JSON.parse(output)
    unless result.fetch("current")
      raise ReleasePipeline::Superseded,
            "Newer eligible main source #{result.fetch("latest")} supersedes #{source}"
    end
  end

  def self.ancestor?(older, newer)
    system(
      "git",
      "merge-base",
      "--is-ancestor",
      older,
      newer,
      chdir: ROOT,
      out: File::NULL,
      err: File::NULL
    )
  end
end
