require "minitest/autorun"
require_relative "../lib/release_operations"

class TestflightDeliveryTest < Minitest::Test
  Group =
    Struct.new(
      :id,
      :name,
      :is_internal_group,
      :public_link_enabled,
      :has_access_to_all_builds
    )
  Build = Struct.new(:id, :processing_state)
  Page = Struct.new(:to_models)
  Response = Struct.new(:all_pages)
  Record =
    Struct.new(:data) do
      def verify_identity!
      end
      def save(values)
        data.merge!(values)
      end
      def advance(state, values = {})
        save(values.merge("state" => state))
      end
    end

  def setup
    @previous = ENV["FOLDING_TESTFLIGHT_GROUPS"]
    ENV["FOLDING_TESTFLIGHT_GROUPS"] = "Owner Preview"
    @groups = [Group.new("group42", "Owner Preview", true, false, false)]
    @members = {}
    @assignments = []
    @build = Build.new("apple42", "VALID")
    @record =
      Record.new(
        {
          "state" => "archived",
          "environment" => "production",
          "build_number" => 42,
          "bundle_id" => "app",
          "asc_app_id" => "asc",
          "marketing_version" => "1.0.0",
          "preview_backend_verification" => {
          }
        }
      )
    @client = Object.new
    api = Object.new
    api.define_singleton_method(:get) do |path|
      raise "Wrong group" unless path == "v1/betaGroups/group42"
      Struct.new(:body).new(
        {
          "data" => {
            "type" => "betaGroups",
            "id" => "group42",
            "attributes" => {
              "feedbackEnabled" => true
            }
          }
        }
      )
    end
    @client.define_singleton_method(:test_flight_request_client) { api }
    members = @members
    @client.define_singleton_method(:get_builds_for_beta_group) do |group_id:|
      Response.new(
        [
          Page.new(
            members.fetch(group_id, []).map { |id| Build.new(id, "VALID") }
          )
        ]
      )
    end
    groups = @groups
    @app = Object.new
    @app.define_singleton_method(:get_beta_groups) { |client:| groups }
  end

  def teardown
    ENV["FOLDING_TESTFLIGHT_GROUPS"] = @previous
  end

  def beta(assign: true, lose_response: false)
    context = Object.new
    assignments, members = @assignments, @members
    context.define_singleton_method(:upload_to_testflight) do |**options|
      unless options[:distribute_only]
        raise "Must never upload an IPA in this distribution-only fixture"
      end
      assignments << options
      members["group42"] = ["apple42"] if assign
      raise "Lost assignment response" if lose_response
    end
    FoldingRelease.stub(:client, @client) do
      FoldingRelease.stub(:app, @app) do
        FoldingRelease.stub(:exact_build, @build) do
          FoldingRelease.stub(:preview_prerequisites!, "worker") do
            FoldingRelease.stub(:api_key, {}) do
              FoldingRelease::Operations.stub(:register_build_policy, nil) do
                FoldingRelease::Operations.stub(:verify_processed!, @build) do
                  FoldingRelease::Operations.beta(context, @record)
                end
              end
            end
          end
        end
      end
    end
  end

  def test_missing_partial_ambiguous_or_external_groups_do_not_record_delivery
    cases = [
      [],
      [Group.new("other", "Other", true, false, false)],
      [
        Group.new("a", "Owner Preview", true, false, false),
        Group.new("b", "Owner Preview", true, false, false)
      ],
      [Group.new("external", "Owner Preview", false, false, false)]
    ]
    cases.each do |groups|
      @groups.replace(groups)
      assert_raises(RuntimeError) { beta }
      refute @record.data.key?("testflight_distributed_build_id")
      assert_empty @assignments
    end
    @groups.replace([Group.new("group42", "Owner Preview", true, false, false)])
    ENV["FOLDING_TESTFLIGHT_GROUPS"] = "Owner Preview,Missing"
    assert_raises(RuntimeError) { beta }
    assert_empty @assignments
  end

  def test_successful_fastlane_return_without_membership_never_confirms_delivery_or_repeats_mutation
    2.times { assert_raises(RuntimeError) { beta(assign: false) } }
    assert_equal 1, @assignments.length
    refute @record.data.key?("testflight_distributed_build_id")
    refute @record.data.key?("testflight_group_assignment_verified_at")
  end

  def test_lost_response_reconciles_membership_once_and_a_later_revocation_is_respected
    assert_raises(RuntimeError) { beta(lose_response: true) }
    refute @record.data.key?("testflight_distributed_build_id")
    beta
    assert_equal 1, @assignments.length
    assert_equal "apple42",
                 @record.data.fetch("testflight_distributed_build_id")
    assert_equal ["group42"], @record.data.fetch("testflight_group_ids")
    assert @record.data.fetch("testflight_group_assignment_verified_at")
    @members.clear
    assert_raises(RuntimeError) { beta }
    assert_equal 1, @assignments.length
  end
end
