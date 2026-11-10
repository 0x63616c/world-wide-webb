require "minitest/autorun"
require_relative "../lib/release_manifest"

class HistoricalArtifactsTest < Minitest::Test
  Status = Struct.new(:success?, :exitstatus)

  def test_legacy_record_reads_use_the_consolidated_artifact_repository
    commands = []
    inspect = lambda do |*args, **_options|
      commands << args
      [JSON.generate({"tagName" => "v0.1.13", "assets" => [{"name" => "manifest-r00000001.json"}]}), "", Status.new(true, 0)]
    end
    download = lambda do |*args|
      commands << args
      directory = args.fetch(args.index("--dir") + 1)
      File.write(File.join(directory, "manifest-r00000001.json"), '{"build_number":14}')
    end
    Open3.stub(:capture3, inspect) do
      FoldingRelease.stub(:run, download) do
        assert_equal 14, FoldingRelease::GitHubArtifacts.new("v0.1.13").latest("manifest").fetch("build_number")
      end
    end
    assert_equal 2, commands.length
    commands.each { |args| assert_equal "0x63616c/world-wide-webb", args.fetch(args.index("--repo") + 1) }
  end

  def test_legacy_artifact_mutations_fail_before_any_provider_operation
    historical = FoldingRelease::GitHubArtifacts.new("v0.1.13")
    forbidden = ->(*_args, **_options) { flunk "Historical artifacts must not cause provider mutations" }
    Open3.stub(:capture3, forbidden) do
      FoldingRelease.stub(:run, forbidden) do
        [-> { historical.ensure_exists("a" * 40) }, -> { historical.upload("unused") },
         -> { historical.upload_artifact("unused") }, -> { historical.publish }].each do |operation|
          assert_match(/historical.*read.only/i, assert_raises(RuntimeError, &operation).message)
        end
      end
    end
  end

  def test_namespaced_new_records_use_the_consolidated_repository
    inspect = lambda do |*args, **_options|
      assert_equal "0x63616c/world-wide-webb", args.fetch(args.index("--repo") + 1)
      ['{"assets":[]}', "", Status.new(true, 0)]
    end
    Open3.stub(:capture3, inspect) do
      assert FoldingRelease::GitHubArtifacts.new("folding/build-15").info
      assert FoldingRelease::GitHubArtifacts.new("folding-build-reservations").info
    end
  end
end
