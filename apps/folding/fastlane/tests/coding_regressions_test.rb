require "minitest/autorun"
require_relative "../lib/release_operations"
require_relative "../lib/tip_products"

class CodingRegressionsTest < Minitest::Test
  def test_public_source_artifacts_stay_in_authenticated_drafts
    remote = FoldingRelease::GitHubArtifacts.new("folding/build-42")
    commands = []
    FoldingRelease.stub(:run, ->(*args) { commands << args; "" }) do
      remote.stub(:info, {"isDraft" => true}) do
        remote.upload("candidate.ipa")
        remote.publish
      end
      assert_equal 1, commands.length
      assert_equal ["gh", "release", "upload"], commands.first.first(3)
      remote.stub(:info, {"isDraft" => false}) do
        assert_raises(RuntimeError) { remote.upload("private.ipa") }
        assert_raises(RuntimeError) { remote.publish }
      end
      remote.stub(:info, nil) { assert_raises(RuntimeError) { remote.publish } }
      assert_equal 1, commands.length
    end
  end

  def test_explicit_main_ci_run_can_supply_beta_checks_but_other_branches_cannot
    run = {"head_sha" => "source", "path" => ".github/workflows/folding-ci.yml", "status" => "completed", "conclusion" => "success", "run_attempt" => 1, "event" => "workflow_dispatch", "head_branch" => "main", "head_repository" => {"full_name" => "0x63616c/world-wide-webb"}}
    check = {"kind" => "ci", "name" => "contracts", "commit_sha" => "source", "conclusion" => "success", "run_url" => "https://github.com/0x63616c/world-wide-webb/actions/runs/1"}
    FoldingRelease.stub(:run, ->(*args) { JSON.generate(args.last.include?("jobs?") ? [{"jobs" => [{"name" => "Folding contracts", "head_sha" => "source", "status" => "completed", "conclusion" => "success"}]}] : run) }) do
      FoldingRelease::CheckEvidence.validate!(check, source: "source", base: ".")
      run["head_branch"] = "feature"
      assert_raises(RuntimeError) { FoldingRelease::CheckEvidence.validate!(check, source: "source", base: ".") }
    end
  end

  def test_workflow_recovery_uses_its_actor_without_the_user_only_api
    previous = ENV.values_at("GITHUB_ACTIONS", "GITHUB_ACTOR")
    ENV["GITHUB_ACTIONS"] = "true"
    ENV["GITHUB_ACTOR"] = "synthetic-ci-actor"
    FoldingRelease.stub(:run, ->(*_arguments) { raise "Installation token cannot call /user" }) do
      assert_equal "synthetic-ci-actor", FoldingRelease.release_actor
    end
  ensure
    ENV["GITHUB_ACTIONS"], ENV["GITHUB_ACTOR"] = previous
  end

  Record = Struct.new(:data, :directory, :remote) do
    def verify_identity!; end
    def save(values); data.merge!(values); end
    def advance(state, values = {}); save(values.merge("state" => state)); end
    def path; File.join(directory, "release.json"); end
  end
  def test_policy_registration_crash_retries_only_confirm_even_without_final_manifest_checkpoint
    previous = ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"]
    [:before_write, :local_receipt, :remote_receipt].each do |boundary|
      Dir.mktmpdir do |directory|
        deployment = File.join(directory, "deployment.json")
        FoldingRelease.atomic_json(deployment, {"runtime_configuration" => {}})
        ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"] = deployment
        remote = Object.new
        remote.instance_variable_set(:@assets, {})
        def remote.info; {"assets" => @assets.keys.map { |name| {"name" => name} }}; end
        def remote.upload_artifact(file); @assets[File.basename(file)] = File.read(file); end
        def remote.download(name, directory); File.write(File.join(directory, name), @assets.fetch(name)); end
        record = Record.new({"build_number" => 42}, directory, remote)
        operation = lambda do |*arguments|
          assert record.data["build_policy_registration_started_at"], "Intent must persist before any possible write"
          refute_includes arguments, "--read-only"
          unless boundary == :before_write
            File.write(File.join(directory, "published-build-receipt.json"), "{}")
          end
          if boundary == :remote_receipt
            artifact = File.join(directory, "published-build-42.json")
            File.write(artifact, "{}")
            remote.upload_artifact(artifact)
            File.delete(File.join(directory, "published-build-receipt.json"))
          end
          raise "Simulated process interruption"
        end
        FoldingRelease.stub(:run, operation) do
          assert_raises(RuntimeError) { FoldingRelease::Operations.register_build_policy(record) }
        end
        refute record.data.key?("build_policy_receipt_sha256")
        FoldingRelease.stub(:run, ->(*arguments) { assert_includes arguments, "--read-only"; raise "Revoked/missing row stays missing" }) do
          assert_raises(RuntimeError) { FoldingRelease::Operations.register_build_policy(record) }
        end
      end
    end
  ensure
    ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"] = previous
  end

  def test_beta_records_the_current_compatible_worker_before_registering_policy
    record = Record.new({"state" => "archived", "deployed_worker_version" => "old"})
    FoldingRelease.stub(:live_prerequisites!, "current") do
      FoldingRelease::Operations.stub(:register_build_policy, ->(value) { assert_equal "current", value.data.fetch("deployed_worker_version"); raise "Stop before Apple" }) do
        assert_raises(RuntimeError) { FoldingRelease::Operations.beta(nil, record) }
      end
    end
  end

  def test_automatic_beta_reconciles_a_lost_upload_response_without_another_binary_upload
    previous = ENV["FOLDING_TESTFLIGHT_GROUPS"]
    ENV["FOLDING_TESTFLIGHT_GROUPS"] = "Owner Preview"
    record = Record.new({"state" => "archived", "environment" => "production", "build_number" => 42,
      "bundle_id" => "app", "asc_app_id" => "asc-app", "marketing_version" => "1.0.0",
      "preview_backend_verification" => {}, "upload_attempt_started_at" => "previous-attempt"})
    build = Struct.new(:id, :processing_state).new("apple42", "VALID")
    reads = 0
    uploads = []
    member = false
    group = Struct.new(:id, :name, :has_access_to_all_builds).new("group42", "Owner Preview", false)
    context = Object.new
    context.define_singleton_method(:upload_to_testflight) { |**options| uploads << options; member = true }
    FoldingRelease.stub(:preview_prerequisites!, "worker") do
      FoldingRelease.stub(:minimum_supported_build, 0) do
        FoldingRelease.stub(:api_key, {}) do
          FoldingRelease.stub(:exact_build, ->(_data) { reads += 1; reads == 1 ? nil : build }) do
            FoldingRelease::Operations.stub(:register_build_policy, nil) do
              FoldingRelease::Operations.stub(:verify_processed!, build) do
                FoldingRelease::Operations.stub(:internal_groups, [group]) do
                  FoldingRelease::Operations.stub(:groups_include_build?, ->(_groups, _build) { member }) do
                    2.times { FoldingRelease::Operations.beta(context, record, wait_for_processing: true) }
                  end
                end
              end
            end
          end
        end
      end
    end
    assert_equal 1, uploads.length
    assert_equal true, uploads.first.fetch(:distribute_only)
    refute uploads.first.key?(:ipa)
    assert_equal "apple42", record.data.fetch("testflight_distributed_build_id")
    assert_equal "VALID", record.data.fetch("asc_processing_state")
  ensure
    ENV["FOLDING_TESTFLIGHT_GROUPS"] = previous
  end
  def test_real_archive_recovery_handles_preview_and_store_states_without_mutating_old_build_identity
    %w[planned assets_ready].each do |state|
      old = Record.new({"state" => state, "build_number" => 42, "tag" => "folding/build-42", "release_id" => "old",
        "environment" => "production", "marketing_version" => "1.0.0", "archive_attempt_started_at" => "time"})
      old.data["preview_backend_verification"] = {"worker_version" => "a" * 40} if state == "planned"
      replacement = Record.new({"state" => "planned", "build_number" => 43, "tag" => "folding/build-43"})
      registered = Struct.new(:id) do
        def get_builds(**); [Struct.new(:version).new("41")]; end
      end
      find = lambda do |identifier, **_options|
        identity = FoldingAppleAccount.config.values.find { |item| item.is_a?(Hash) && item["bundle_id"] == identifier }
        registered.new(identity.fetch("app_store_id"))
      end
      reserve = lambda do |**arguments|
        assert_equal "old", arguments.fetch(:replacement_for)
        assert_equal "1.0.0", arguments.fetch(:version)
        replacement
      end
      FoldingRelease.stub(:release_actor, "test-actor") do
        FoldingRelease.stub(:client, :test_client) do
          Spaceship::ConnectAPI::App.stub(:find, find) do
            FoldingRelease.stub(:reserve, reserve) do
              assert_same replacement, FoldingRelease::Operations.replace_interrupted_archive(old, reason: "interrupted build")
            end
          end
        end
      end
      assert_equal 42, old.data.fetch("build_number")
      assert_equal true, old.data.fetch("cancelled")
      assert_equal "folding/build-43", old.data.fetch("replacement_tag")
      assert_equal "test-actor", replacement.data.fetch("archive_replacement").fetch("actor")
      FoldingRelease.stub(:follow_replacement, ->(tag) { assert_equal "folding/build-42", tag; replacement }) do
        assert_same replacement, FoldingRelease::Operations.replace_interrupted_archive(old, reason: "retry")
      end
    end
  end
  def test_preview_requires_complete_capabilities_and_verified_compatible_backend
    source = "a" * 40
    record = Record.new({"commit_sha" => source, "archive_configuration" => {"api_origin" => "https://api.example"}})
    accepted = {"contract_version" => 1, "worker_version" => source, "capabilities" => ["profiles.milestones", "events.history_import", "notifications.badges"]}
    [{"capabilities" => []}, {"capabilities" => ["profiles.milestones"]}, {"contract_version" => 2}].each do |change|
      FoldingRelease.stub(:fetch_json, accepted.merge(change)) do
        assert_raises(RuntimeError) { FoldingRelease.preview_prerequisites!(record) }
      end
    end
    FoldingRelease.stub(:fetch_json, accepted) do
      FoldingRelease.stub(:verified_backend!, ->(_record, backend) { backend.fetch("worker_version") }) do
        assert_equal source, FoldingRelease.preview_prerequisites!(record)
      end
    end
    assert_equal ["profiles.milestones", "events.history_import", "notifications.badges"], record.data.fetch("preview_backend_verification").fetch("capabilities")
  end
  class Apple
    attr_reader :review_items, :created, :tip_versions, :version_creations
    def initialize
      @review_items = []
      @created = 0
      @version_creations = 0
      @tip_versions = 3.times.to_h do |i|
        ["p#{i}", [{"id" => "vp#{i}", "attributes" => {"state" => "PREPARE_FOR_SUBMISSION"}}]]
      end
    end
    def all(path)
      case path
      when /inAppPurchasesV2/
        FoldingRelease::CONFIG.fetch("tip_product_ids").each_with_index.map { |name, i| {"id" => "p#{i}", "attributes" => {"productId" => name, "state" => "READY_TO_SUBMIT"}} }
      when %r{/v2/inAppPurchases/(p\d)/versions}
        @tip_versions.fetch(Regexp.last_match(1))
      when /\/items/ then @review_items
      when /reviewSubmissions\?/ then [{"id" => "s1", "attributes" => {"state" => "READY_FOR_REVIEW"}}]
      else raise "Unexpected read #{path}"
      end
    end
    def request(method, path, body: nil)
      if method == "POST" && path == "/v1/inAppPurchaseVersions"
        @version_creations += 1
        product = body.dig("data", "relationships", "inAppPurchase", "data", "id")
        row = {"id" => "v#{product}", "attributes" => {"state" => "PREPARE_FOR_SUBMISSION"}}
        @tip_versions.fetch(product) << row
        return {"data" => row}
      end
      if method == "POST" && path == "/v1/reviewSubmissionItems"
        @created += 1
        @review_items << body.fetch("data").merge("id" => "item#{@created}")
        if (version = body.dig("data", "relationships", "inAppPurchaseVersion", "data", "id"))
          @tip_versions.values.flatten.find { |row| row["id"] == version }.fetch("attributes")["state"] = "READY_FOR_REVIEW"
        end
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
    assert_equal 0, api.version_creations
    assert_equal 3, record.data.fetch("submission_tip_versions").length
    api.review_items.pop
    assert_raises(RuntimeError) { FoldingRelease::ReviewSubmission.verify_items!(record, api: api) }
  end

  def test_new_tip_versions_are_attached_from_prepare_for_submission_and_reused
    api = Apple.new
    api.tip_versions.each_value(&:clear)
    record = Record.new({"asc_app_id" => "app"})
    2.times { FoldingRelease::ReviewSubmission.prepare(record, "app-version", api: api) }
    assert_equal 3, api.version_creations
    assert_equal 4, api.created
    assert_equal 3, record.data.fetch("submission_tip_versions").length
  end

  def test_multiple_editable_tip_versions_are_not_adopted
    api = Apple.new
    api.tip_versions.fetch("p0") << {"id" => "unrelated", "attributes" => {"state" => "PREPARE_FOR_SUBMISSION"}}
    assert_raises(RuntimeError) do
      FoldingRelease::ReviewSubmission.prepare(Record.new({"asc_app_id" => "app"}), "app-version", api: api)
    end
    assert_equal 0, api.created
    assert_equal 0, api.version_creations
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
    run = {"head_sha" => "source", "path" => ".github/workflows/folding-ci.yml", "status" => "completed", "conclusion" => "success", "run_attempt" => 1, "event" => "push", "head_branch" => "main", "head_repository" => {"full_name" => "0x63616c/world-wide-webb"}}
    FoldingRelease.stub(:run, ->(*args) { args.last.include?("jobs?") ? JSON.generate([{"jobs" => [{"name" => "Other", "head_sha" => "source", "status" => "completed", "conclusion" => "success"}]}]) : JSON.generate(run) }) do
      check = {"kind" => "ci", "name" => "contracts", "commit_sha" => "source", "conclusion" => "success", "run_url" => "https://github.com/0x63616c/world-wide-webb/actions/runs/1"}
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
