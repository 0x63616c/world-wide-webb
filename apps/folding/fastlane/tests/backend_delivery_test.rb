require "minitest/autorun"
require_relative "../lib/backend_delivery"

class BackendDeliveryTest < Minitest::Test
  Delivery = FoldingRelease::BackendDelivery
  class Store
    attr_reader :assets
    def initialize; @assets = {}; end
    def info; {"assets" => assets.keys.map { |name| {"name" => name} }}; end
    def ensure_exists(_source); end
    def upload_artifact(path)
      name, bytes = File.basename(path), File.read(path)
      raise "Immutable artifact changed" if assets[name] && assets[name] != bytes
      assets[name] = bytes
    end
    def download(name, directory); File.write(File.join(directory, name), assets.fetch(name)); end
    def latest(prefix)
      name = assets.keys.grep(/\A#{prefix}-r\d{8}\.json\z/).max
      name && JSON.parse(assets.fetch(name))
    end
    def upload(path); upload_artifact(path); end
  end

  def setup
    @original_root = FoldingRelease::ROOT
    @root = Dir.mktmpdir("folding-backend-delivery-test")
    FoldingRelease.send(:remove_const, :ROOT)
    FoldingRelease.const_set(:ROOT, @root)
    @source, @old = "a" * 40, "b" * 40
    @version = "11111111-2222-3333-4444-555555555555"
    @config = {"name" => "folding-api-production", "account_id" => "c" * 32,
      "vars" => {"DEPLOYMENT" => "production", "APP_ATTEST_APP_ID" => "#{FoldingRelease::CONFIG.fetch('apple_team_id')}.app.getfolding.Folding", "WORKER_VERSION" => @old, "ADMIN_EMAIL_ALLOWLIST" => "operator-private-value", "VERIFIED_CAPABILITIES" => "[]", "APNS_ENABLED" => "false", "AVATAR_UPLOADS_ENABLED" => "false", "ADMIN_EMAIL_ENABLED" => "false"},
      "d1_databases" => [{"binding" => "DB", "database_name" => "folding-production", "database_id" => @version}]}
    @previous = ENV["FOLDING_PRODUCTION_WORKER_CONFIG"]
    ENV["FOLDING_PRODUCTION_WORKER_CONFIG"] = JSON.generate(@config)
    @artifact = File.join(@root, "backend/crates/worker/build")
    files = %w[index.js index_bg.wasm package.json worker/shim.mjs]
    files.each { |name| path = File.join(@artifact, name); FileUtils.mkdir_p(File.dirname(path)); File.write(path, name) }
    FoldingRelease.atomic_json(File.join(@artifact, "artifact.json"), {"source_sha" => @source, "files" => files.to_h { |name| [name, FoldingRelease.sha(File.join(@artifact, name))] }})
  end

  def teardown
    ENV["FOLDING_PRODUCTION_WORKER_CONFIG"] = @previous
    FoldingRelease.send(:remove_const, :ROOT)
    FoldingRelease.const_set(:ROOT, @original_root)
    FileUtils.remove_entry(@root)
  end

  def test_tested_artifact_cannot_change_source_bytes_or_add_unverified_files
    Delivery.verify_artifact!(@source)
    assert_raises(RuntimeError) { Delivery.verify_artifact!(@old) }
    File.write(File.join(@artifact, "index_bg.wasm"), "tampered")
    assert_raises(RuntimeError) { Delivery.verify_artifact!(@source) }
  end

  def test_readiness_claims_cannot_be_relabelled_over_changed_backend_inputs
    @config.fetch("vars")["VERIFIED_CAPABILITIES"] = '["profiles.milestones"]'
    ENV["FOLDING_PRODUCTION_WORKER_CONFIG"] = JSON.generate(@config)
    FoldingRelease.stub(:backend_input_hash, ->(source) { source == @source ? "changed" : "approved" }) do
      assert_raises(RuntimeError) { Delivery.configuration(@source) }
    end
    FoldingRelease.stub(:backend_input_hash, "same-runtime-inputs") do
      assert_equal @source, Delivery.configuration(@source).fetch("vars").fetch("WORKER_VERSION")
    end
    assert_equal @old, JSON.parse(ENV.fetch("FOLDING_PRODUCTION_WORKER_CONFIG")).fetch("vars").fetch("WORKER_VERSION")
    @config.fetch("vars").delete("VERIFIED_CAPABILITIES")
    ENV["FOLDING_PRODUCTION_WORKER_CONFIG"] = JSON.generate(@config)
    assert_raises(KeyError) { Delivery.configuration(@source) }
  end

  def test_native_queue_coalesces_inputs_and_never_rolls_back_a_newer_delivered_source
    store = Store.new
    input = "same-native-inputs"
    record = Struct.new(:data).new({"commit_sha" => @old, "tag" => "folding/build-42", "build_number" => 42, "asc_processing_state" => "VALID", "testflight_distributed_build_id" => "apple42", "testflight_group_ids" => ["group42"], "testflight_group_assignment_verified_at" => "2026-11-08T00:00:00Z"})
    Delivery.stub(:store, store) do
      Delivery.stub(:native_input_hash, ->(_source) { input }) do
        Delivery.record_native_delivery(record)
        FoldingRelease.stub(:clean_commit!, @source) do
          Delivery.stub(:superseded?, false) do
            refute Delivery.native_needed?, "Backend-only source with identical native inputs must not ship a beta"
            input = "new-native-inputs"
            assert Delivery.native_needed?, "A replaced queued native request must be picked up by the newer source"
          end
          Delivery.stub(:superseded?, true) do
            input = "obsolete-inputs"
            refute Delivery.native_needed?, "A late older CI completion cannot roll back the distributed app"
          end
        end
        Delivery.record_native_delivery(record)
        assert_equal 1, store.assets.length
      end
    end
  end

  def test_submission_retry_reuses_a_distributed_candidate_instead_of_skipping_it
    source = @source
    delivered = {"source_sha" => source, "input_hash" => "same", "release_tag" => "folding/build-42"}
    store = Object.new
    store.define_singleton_method(:latest) { |_| delivered }
    record = Struct.new(:data).new({"state" => "processed"})
    Delivery.stub(:store, store) do
      Delivery.stub(:native_input_hash, "same") do
        FoldingRelease.stub(:clean_commit!, source) do
          FoldingRelease::Record.stub(:new, record) do
            refute Delivery.native_needed?
            assert Delivery.native_needed?(include_submission: true)
            record.data["state"] = "submitted"
            refute Delivery.native_needed?(include_submission: true)
          end
        end
      end
    end
  end

  def test_provider_database_is_checked_before_any_migration_or_deploy
    config = Delivery.configuration(@source)
    deployments = {"success" => true, "result" => {"deployments" => [{"versions" => [{"version_id" => @version, "percentage" => 100}]}]}}
    version = {"success" => true, "result" => {"id" => @version, "resources" => {"bindings" => [
      {"name" => "WORKER_VERSION", "type" => "plain_text", "text" => @old},
      {"name" => "DEPLOYMENT", "type" => "plain_text", "text" => "production"},
      {"name" => "APP_ATTEST_APP_ID", "type" => "plain_text", "text" => config.fetch("vars").fetch("APP_ATTEST_APP_ID")},
      {"name" => "DB", "type" => "d1", "id" => "different-database"}]}}}
    Delivery.stub(:provider, ->(_config, suffix) { suffix == "deployments" ? deployments : version }) do
      assert_raises(RuntimeError) { Delivery.current(config) }
      version.fetch("result").fetch("resources").fetch("bindings").last["id"] = @version
      assert_equal [@old, @version], Delivery.current(config)
    end
  end

  def test_deployment_reconciles_migration_and_provider_crashes_without_rebuilding_or_overwriting_recovery
    [:migration, :provider_receipt].each do |boundary|
      store = Store.new
      live_source = @old
      events = []
      fail_once = true
      command = lambda do |*arguments|
        case arguments[0, 3]
        when ["gh", "repo", "view"] then '{"visibility":"PRIVATE"}'
        else
          if arguments.include?("time-travel")
            events << :bookmark
            '{"bookmark":"00001-00002-00003"}'
          elsif arguments.first == "python3"
            assert store.assets.keys.any? { |name| name.start_with?("recovery-") }, "Recovery metadata must publish before migration"
            events << :migration
            if boundary == :migration && fail_once
              fail_once = false
              raise "Interrupted migration"
            end
            ""
          elsif arguments.include?("deploy")
            events << :deploy
            live_source = @source
            ""
          else
            raise "Unexpected external operation #{arguments.first}"
          end
        end
      end
      verify = lambda do |_record, backend|
        assert_equal @source, backend.fetch("worker_version")
        if boundary == :provider_receipt && fail_once
          fail_once = false
          raise "Interrupted after provider confirmed deployment"
        end
        @source
      end
      FoldingRelease.stub(:clean_commit!, @source) do
        FoldingRelease.stub(:run, command) do
          FoldingRelease::CheckEvidence.stub(:validate!, nil) do
            FoldingRelease.stub(:backend_input_hash, "hash") do
              FoldingRelease.stub(:fetch_json, ->(_url) { {"worker_version" => live_source} }) do
                FoldingRelease.stub(:verified_backend!, verify) do
                  Delivery.stub(:store, store) do
                    Delivery.stub(:current, ->(_config) { [live_source, @version] }) do
                      assert_raises(RuntimeError) { Delivery.deploy(run_url: "trusted-ci-run") }
                      2.times { |index| Delivery.deploy(run_url: "trusted-ci-rerun-#{index}") }
                    end
                  end
                end
              end
            end
          end
        end
      end
      assert_equal 1, events.count(:bookmark)
      assert_equal 1, events.count(:deploy)
      assert_equal(boundary == :migration ? 2 : 1, events.count(:migration))
      receipt = JSON.parse(store.assets.fetch(Delivery.receipt_name(@source, @version)))
      assert_equal @source, receipt.fetch("runtime_configuration").fetch("vars").fetch("WORKER_VERSION")
      assert_equal "trusted-ci-rerun-0", receipt.fetch("backend_check").fetch("run_url")
      refute receipt.to_json.include?("operator-private-value")
    end
  end
end
