require "minitest/autorun"
require_relative "../lib/automatic_release"

class AutomaticReleaseTest < Minitest::Test
  Release = FoldingRelease::AutomaticRelease
  Record = Struct.new(:data)

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
    assert_equal [:mark, :assets, :verified, :withdraw], sequence
  end
end
