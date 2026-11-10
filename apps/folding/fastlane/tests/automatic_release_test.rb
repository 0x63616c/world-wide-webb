require "minitest/autorun"
require_relative "../lib/automatic_release"

class AutomaticReleaseTest < Minitest::Test
  Release = FoldingRelease::AutomaticRelease
  Record = Struct.new(:data)

  def test_saved_review_contact_is_preserved_without_forwarding_private_values_to_deliver
    previous = FoldingRelease::CONFIG.fetch("review_contact_env").values.to_h { |name| [name, ENV.delete(name)] }
    detail = Struct.new(:contact_first_name, :contact_last_name, :contact_phone, :contact_email)
      .new("Reviewer", "Contact", "synthetic-phone", "reviewer@example.invalid")
    selected = Object.new
    selected.define_singleton_method(:fetch_app_store_review_detail) { |client:| detail }
    FoldingRelease.stub(:client, Object.new) do
      FoldingRelease::Operations.stub(:version, selected) do
        assert_empty FoldingRelease::Operations.review_contact(nil)
        detail.contact_phone = ""
        assert_raises(RuntimeError) { FoldingRelease::Operations.review_contact(nil) }
      end
    end
  ensure
    previous&.each { |name, value| ENV[name] = value }
  end

  def test_deferred_testflight_uses_an_open_new_patch_train
    rows = [{"attributes" => {"versionString" => "1.0.0", "appStoreState" => "IN_REVIEW"}}]
    client = Struct.new(:tunes_request_client).new(Object.new)
    FoldingRelease.stub(:client, client) do
      Release.stub(:configured_version, "1.0.0") do
        ReleasePipeline.stub(:all, rows) { assert_equal "1.0.1", Release.beta_version }
      end
    end
  end

  def test_missing_required_capability_acceptance_stops_before_capture_or_review_mutations
    record = Record.new({"commit_sha" => "a" * 40})
    ReleaseSource.stub(:current!, nil) do
      FoldingRelease.stub(:live_prerequisites!, ->(_) { raise "Required backend capabilities missing: events.history_import" }) do
        Release.stub(:mark_source, ->(_) { flunk "Must preserve Apple state" }) do
          error = assert_raises(RuntimeError) { Release.finish(nil, record) }
          assert_includes error.message, "events.history_import"
        end
      end
    end
  end

  def test_a_superseded_source_stops_before_backend_or_apple_operations
    record = Record.new({"commit_sha" => "a" * 40})
    ReleaseSource.stub(:current!, ->(*) { raise ReleasePipeline::Superseded, "Newer main" }) do
      FoldingRelease.stub(:live_prerequisites!, ->(_) { flunk "Superseded source must stop" }) do
        assert_raises(ReleasePipeline::Superseded) { Release.finish(nil, record) }
      end
    end
  end

  def test_replacement_is_prepared_before_a_waiting_review_can_be_withdrawn
    sequence = []
    record = Record.new({"commit_sha" => "a" * 40, "marketing_version" => "1.0.0"})
    pending = Object.new
    pending.define_singleton_method(:replace!) do |*, **|
      sequence << :withdraw
      raise ReleasePipeline::Deferred, "Review started; preserve it"
    end
    Release.stub(:ensure_app_configuration, nil) do
      ReleaseSource.stub(:current!, nil) do
        FoldingRelease.stub(:live_prerequisites!, nil) do
          Release.stub(:mark_source, ->(_) { sequence << :mark }) do
            FoldingRelease::Operations.stub(:assets, ->(*) { sequence << :assets }) do
              Release.stub(:preflight, ->(_) { sequence << :verified }) do
                Release.stub(:planner, pending) do
                  FoldingRelease::Operations.stub(:storefront, ->(*) { flunk "Review must remain untouched" }) do
                    assert_raises(ReleasePipeline::Deferred) { Release.finish(nil, record) }
                  end
                end
              end
            end
          end
        end
      end
    end
    assert_equal [:mark, :assets, :verified, :withdraw], sequence
  end
end

class ReleaseConfigurationTest < Minitest::Test
  class Apple
    attr_accessor :rights, :schedule, :price
    attr_reader :writes
    def initialize; @writes = []; @price = "0.00"; end
    def request(method, path, body: nil, **)
      @writes << [method, path, body] unless method == "GET"
      case [method, path]
      when ["GET", "/v1/apps/6832059501"]
        {"data" => {"attributes" => {"contentRightsDeclaration" => rights}}}
      when ["PATCH", "/v1/apps/6832059501"]
        @rights = body.dig("data", "attributes", "contentRightsDeclaration"); {}
      when ["GET", "/v1/apps/6832059501/appPriceSchedule"]
        {"data" => schedule && {"id" => "schedule"}}
      when ["POST", "/v1/appPriceSchedules"]
        raise "Must use real free point" unless body.dig("included", 0, "relationships", "appPricePoint", "data", "id") == "real-free-point"
        @schedule = true; {}
      when ["GET", "/v1/appPriceSchedules/schedule/manualPrices?include=appPricePoint&limit=200"]
        {"data" => [{"id" => "base"}], "included" => [{"type" => "appPricePoints", "attributes" => {"customerPrice" => price}}]}
      else raise "Unexpected Apple operation"
      end
    end
    def all(path)
      raise "Wrong lookup" unless path.include?("appPricePoints")
      [{"id" => "real-paid-point", "attributes" => {"customerPrice" => "1.00"}}, {"id" => "real-free-point", "attributes" => {"customerPrice" => "0.00"}}]
    end
  end

  def test_first_release_saves_approved_rights_and_free_price_and_preserves_existing_configuration
    api = Apple.new
    record = Struct.new(:data).new({"asc_app_id" => "6832059501"})
    2.times { FoldingRelease::AutomaticRelease.ensure_app_configuration(record, api: api) }
    assert_equal ["PATCH", "POST"], api.writes.map(&:first)
    assert_equal "USES_THIRD_PARTY_CONTENT", api.rights
    api.price = "1.00"
    assert_raises(RuntimeError) { FoldingRelease::AutomaticRelease.ensure_app_configuration(record, api: api) }
    assert_equal 2, api.writes.length
  end

  def test_nested_apple_errors_preserve_validation_codes_without_private_values
    response = {"errors" => [{"code" => "STATE_ERROR", "detail" => "private@example.invalid", "meta" => {"associatedErrors" => {
      "/v1/apps/fixture" => [{"code" => "ENTITY_ERROR.ATTRIBUTE.REQUIRED", "source" => {"pointer" => "/data/attributes/contentRightsDeclaration"}, "detail" => "private phone"}],
      "/v2/appPrices/" => [{"code" => "STATE_ERROR.APP_PRICING_REQUIRED"}]}}}]}
    codes = FoldingTipProducts::API.error_codes(JSON.generate(response))
    assert_equal ["STATE_ERROR", "ENTITY_ERROR.ATTRIBUTE.REQUIRED /data/attributes/contentRightsDeclaration", "STATE_ERROR.APP_PRICING_REQUIRED"], codes
    refute_includes codes.join, "private"
  end
end

class StorefrontBuildAttachmentTest < Minitest::Test
  def test_metadata_only_upload_explicitly_attaches_the_exact_processed_build_on_resume
    record = Struct.new(:data).new({"state" => "processed", "asc_build_id" => "processed-build", "storefront_upload_completed_at" => "completed", "bundle_id" => "fixture", "marketing_version" => "1.0.0", "build_number" => 21})
    def record.advance(state); data["state"] = state; end
    selected = Object.new
    selected.define_singleton_method(:select_build) { |client:, build_id:| @attached = build_id }
    selected.define_singleton_method(:get_build) do |client:|
      raise "No data: metadata upload did not attach a build" unless @attached
      Struct.new(:id).new(@attached)
    end
    operations = FoldingRelease::Operations
    FoldingRelease.stub(:client, Object.new) do
      FoldingRelease.stub(:api_key, {}) do
        FoldingRelease::AutomaticRelease.stub(:preflight, nil) do
          operations.stub(:restore_assets, "/unused") do
            operations.stub(:review_contact, {}) do
              operations.stub(:version, selected) do
                operations.stub(:verify_processed!, Struct.new(:id).new("processed-build")) do
                  FoldingRelease::StorefrontReadback.stub(:verify!, nil) do
                    assert_same selected, operations.storefront(nil, record)
                    assert_equal "ready_to_submit", record.data["state"]
                  end
                end
              end
            end
          end
        end
      end
    end
  end
end

class ArchiveDeviceFamilyTest < Minitest::Test
  def test_accidental_ipad_support_stops_before_signing_inspection_or_publication
    Dir.mktmpdir do |directory|
      FileUtils.mkdir_p(File.join(directory, "PlugIns/Widgets.appex"))
      record = Struct.new(:data).new({"archive_configuration" => {"identity" => {"bundle_id" => "fixture", "widget_bundle_id" => "fixture.widget"}}})
      FoldingRelease::Operations.stub(:plist, {"UIDeviceFamily" => [1, 2]}) do
        FoldingRelease.stub(:run, ->(*) { flunk "Wrong device family must stop publication" }) do
          error = assert_raises(RuntimeError) { FoldingRelease::Operations.inspect_binary!(directory, record) }
          assert_includes error.message, "iPhone only"
        end
      end
    end
  end
end
