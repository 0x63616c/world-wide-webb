require "minitest/autorun"
require_relative "../lib/release_operations"
require_relative "../lib/tip_products"

class CodingRegressionsTest < Minitest::Test
  Record = Struct.new(:data, :directory, :remote) do
    def verify_identity!; end
    def save(values); data.merge!(values); end
    def advance(state, values = {}); save(values.merge("state" => state)); end
  end
  def test_preview_requires_the_complete_milestone_capability_and_exact_worker_source
    source = "a" * 40
    record = Record.new({"commit_sha" => source, "archive_configuration" => {"api_origin" => "https://api.example"}})
    accepted = {"contract_version" => 1, "worker_version" => source, "capabilities" => ["profiles.milestones"]}
    [{"capabilities" => []}, {"worker_version" => "b" * 40}, {"contract_version" => 2}].each do |change|
      FoldingRelease.stub(:fetch_json, accepted.merge(change)) do
        assert_raises(RuntimeError) { FoldingRelease.preview_prerequisites!(record) }
      end
    end
    FoldingRelease.stub(:fetch_json, accepted) do
      assert_equal source, FoldingRelease.preview_prerequisites!(record)
    end
    assert_equal ["profiles.milestones"], record.data.fetch("preview_backend_verification").fetch("capabilities")
  end
  class Apple
    attr_reader :review_items, :created
    def initialize
      @review_items = []
      @created = 0
    end
    def all(path)
      case path
      when /inAppPurchasesV2/
        FoldingRelease::CONFIG.fetch("tip_product_ids").each_with_index.map { |name, i| {"id" => "p#{i}", "attributes" => {"productId" => name, "state" => "READY_TO_SUBMIT"}} }
      when %r{/v2/inAppPurchases/(p\d)/versions}
        [{"id" => "v#{Regexp.last_match(1)}", "attributes" => {"state" => "READY_FOR_REVIEW"}}]
      when /\/items/ then @review_items
      when /reviewSubmissions\?/ then [{"id" => "s1", "attributes" => {"state" => "READY_FOR_REVIEW"}}]
      else raise "Unexpected read #{path}"
      end
    end
    def request(method, path, body: nil)
      if method == "POST" && path == "/v1/reviewSubmissionItems"
        @created += 1
        @review_items << body.fetch("data").merge("id" => "item#{@created}")
        return {"data" => @review_items.last}
      end
      if method == "GET" && path =~ %r{/v1/inAppPurchaseVersions/v(p\d)}
        return {"data" => {"relationships" => {"inAppPurchase" => {"data" => {"id" => Regexp.last_match(1)}}}}}
      end
      if method == "GET" && path == "/v1/reviewSubmissions/s1"
        return {"data" => {"id" => "s1", "attributes" => {"state" => "READY_FOR_REVIEW"}}}
      end
      raise "Unexpected mutation #{method} #{path}"
    end
  end

  def test_first_submission_contains_all_three_tip_versions_and_app_without_duplicate_retry
    api = Apple.new
    record = Record.new({"asc_app_id" => "app"})
    2.times { FoldingRelease::ReviewSubmission.prepare(record, "app-version", api: api) }
    assert_equal 4, api.created
    assert_equal 3, record.data.fetch("submission_tip_versions").length
    api.review_items.pop
    assert_raises(RuntimeError) { FoldingRelease::ReviewSubmission.verify_items!(record, api: api) }
  end

  def test_unrelated_draft_item_is_never_adopted
    api = Apple.new
    api.review_items << {"relationships" => {"appStoreVersion" => {"data" => {"id" => "other-version"}}}}
    assert_raises(RuntimeError) do
      FoldingRelease::ReviewSubmission.prepare(Record.new({"asc_app_id" => "app"}), "wanted", api: api)
    end
    assert_equal 0, api.created
  end

  def test_local_evidence_binds_command_and_actual_log_hash
    Dir.mktmpdir do |directory|
      File.write(File.join(directory, "output.log"), "passed\n")
      evidence = {"kind" => "local", "name" => "contracts", "commit_sha" => "source", "conclusion" => "success",
        "commands" => FoldingRelease::CheckEvidence::COMMANDS.fetch("contracts"),
        "started_at" => "2026-11-07T00:00:00Z", "finished_at" => "2026-11-07T00:00:01Z",
        "toolchain_manifest_sha256" => FoldingRelease.sha(File.join(FoldingRelease::ROOT, "tool-versions.json")),
        "logs" => [{"name" => "output.log", "sha256" => FoldingRelease.sha(File.join(directory, "output.log")), "exit_status" => 0}]}
      file = File.join(directory, "evidence.json")
      FoldingRelease.atomic_json(file, evidence)
      check = evidence.slice("kind", "name", "commit_sha", "conclusion").merge("evidence_path" => file, "evidence_sha256" => FoldingRelease.sha(file))
      FoldingRelease::CheckEvidence.validate!(check, source: "source", base: directory)
      File.write(File.join(directory, "output.log"), "changed\n")
      assert_raises(RuntimeError) { FoldingRelease::CheckEvidence.validate!(check, source: "source", base: directory) }
    end
  end

  def test_unrelated_successful_ci_run_cannot_satisfy_named_job
    run = {"head_sha" => "source", "path" => ".github/workflows/checks.yml", "status" => "completed", "conclusion" => "success", "run_attempt" => 1}
    FoldingRelease.stub(:run, ->(*args) { args.last.include?("jobs?") ? JSON.generate([{"jobs" => [{"name" => "Other", "head_sha" => "source", "status" => "completed", "conclusion" => "success"}]}]) : JSON.generate(run) }) do
      check = {"name" => "contracts", "commit_sha" => "source", "conclusion" => "success", "run_url" => "https://github.com/0x63616c/folding/actions/runs/1"}
      assert_raises(RuntimeError) { FoldingRelease::CheckEvidence.validate!(check, source: "source", base: ".") }
    end
  end

  def test_signing_failure_does_not_burn_archive_attempt_and_cleanup_runs
    context = Object.new
    def context.create_keychain(**); end
    def context.match(**); raise "signing unavailable"; end
    def context.delete_keychain(**); @deleted = true; end
    def context.deleted; @deleted; end
    record = Record.new({"state" => "assets_ready", "build_number" => 42, "apple_team_id" => "test",
      "archive_configuration" => {"identity" => {"bundle_id" => "app", "widget_bundle_id" => "widget"}}})
    FoldingRelease.stub(:clean_commit!, "source") do
      FoldingRelease.stub(:api_key, {}) do
        FoldingRelease::Operations.stub(:restore_assets, "assets") do
          2.times { assert_raises(RuntimeError) { FoldingRelease::Operations.archive(context, record) } }
        end
      end
    end
    assert_equal 2, record.data.fetch("signing_attempts").length
    assert_nil record.data["archive_attempt_started_at"]
    assert context.deleted
  end

  def test_asset_candidate_retry_preserves_hashes_and_rejects_changed_manifest
    Dir.mktmpdir do |directory|
      assets = File.join(directory, "assets")
      FileUtils.mkdir_p(File.join(assets, "metadata"))
      %w[screenshot-manifest.json tip-review-manifest.json tip-review-screenshots.json metadata-manifest.json].each { |name| File.write(File.join(assets, name), "{}") }
      File.write(File.join(assets, "metadata/copyright.txt"), "owner")
      remote = Object.new
      def remote.upload_artifact(_); end
      record = Record.new({"state" => "validated", "artifacts" => {}}, directory, remote)
      FoldingRelease::Assets.stub(:validate!, nil) do
        FoldingRelease::Operations.assets(nil, record)
        assert_equal "assets_ready", record.data["state"]
        assert_equal record.data["assets_candidate_manifests"]["tip_review_manifest_sha256"], record.data["tip_review_manifest_sha256"]
        record.data["state"] = "validated"
        FoldingRelease::Operations.assets(nil, record)
        record.data["state"] = "validated"
        File.write(File.join(assets, "tip-review-manifest.json"), '{"changed":true}')
        assert_raises(RuntimeError) { FoldingRelease::Operations.assets(nil, record) }
      end
    end
  end
end
