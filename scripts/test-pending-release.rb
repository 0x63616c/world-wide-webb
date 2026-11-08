require "minitest/autorun"
require "ostruct"
require_relative "pending-release"

class PendingReleaseTest < Minitest::Test
  OLD = "a" * 40
  NEW = "b" * 40

  class Apple
    attr_reader :writes
    attr_accessor :state, :version_state, :item_state, :source, :extra, :advance_on_last_read, :complete_cancel, :purchase_state, :cancel_error
    def initialize
      @state = @version_state = "WAITING_FOR_REVIEW"
      @item_state = "READY_FOR_REVIEW"
      @source = OLD
      @purchase_state = "WAITING_FOR_REVIEW"
      @writes = []
      @complete_cancel = true
      @reads = 0
    end

    def get(path)
      data = case path
             when /reviewSubmissions\?/ then [review]
             when "v1/reviewSubmissions/review"
               @reads += 1
               @state = "IN_REVIEW" if @advance_on_last_read && @reads >= 2
               review
             when /\/items\?/
               items = [item("appStoreVersion", "appStoreVersions", "version"), item("inAppPurchaseVersion", "inAppPurchaseVersions", "tip")]
               items << item("appEvent", "appEvents", "event") if @extra
               items
             when "v1/appStoreVersions/version" then version
             when "v1/appStoreVersions/version/build" then { "id" => "build" }
             when "v1/inAppPurchaseVersions/tip" then { "attributes" => { "state" => @purchase_state } }
             when /betaBuildLocalizations/ then [{ "attributes" => { "whatsNew" => "Build from main (#{@source})" } }]
             else raise path
             end
      OpenStruct.new(body: { "data" => data })
    end

    def review
      { "id" => "review", "attributes" => { "state" => @state } }
    end

    def version
      { "id" => "version", "attributes" => { "appVersionState" => @version_state, "versionString" => "1.1.1" } }
    end

    def item(relation, type, id)
      { "id" => id, "attributes" => { "state" => @item_state }, "relationships" => { relation => { "data" => { "type" => type, "id" => id } } } }
    end

    def patch(path, body)
      @writes << [path, body]
      if @cancel_error
        @state = "IN_REVIEW"
        raise "409: submission changed"
      end
      if @complete_cancel
        @state = "COMPLETE"
        @version_state = "DEVELOPER_REJECTED"
      else
        @state = "CANCELING"
      end
      OpenStruct.new(body: { "data" => review })
    end
  end

  def setup
    @api = Apple.new
    @coordinator = PendingRelease.new(@api, "app", NEW, ancestor: ->(a, b) { a == OLD && b == NEW }, sleeper: ->(_) {})
  end

  def test_planning_reuses_waiting_version_without_cancellation
    assert_equal ["1.1.1", "version"], @coordinator.plan([@api.version], "1.1.0")
    assert_empty @api.writes
  end

  def test_replacement_preserves_joint_purchase_targets_and_waits_for_editability
    required = @coordinator.replace!("1.1.1")
    assert_includes required, ["inAppPurchaseVersion", "inAppPurchaseVersions", "tip"]
    assert_equal 1, @api.writes.length
    assert_equal({ canceled: true }, @api.writes.first.last[:data][:attributes])
    assert_equal "DEVELOPER_REJECTED", @api.version_state
  end

  def test_same_source_does_not_restart_review
    @api.source = NEW
    assert_raises(ReleasePipeline::AlreadySubmitted) { @coordinator.plan([@api.version], "1.1.0") }
    assert_raises(ReleasePipeline::AlreadySubmitted) { @coordinator.replace!("1.1.1") }
    assert_empty @api.writes
    @api.version_state = @api.state = "IN_REVIEW"
    assert_raises(ReleasePipeline::AlreadySubmitted) { @coordinator.plan([@api.version], "1.1.0") }
  end

  def test_untracked_or_newer_submission_is_never_withdrawn
    [nil, "untracked", "c" * 40].each do |source|
      @api.source = source
      assert_raises(ReleasePipeline::Deferred) { @coordinator.replace!("1.1.1") }
    end
    assert_empty @api.writes
  end

  def test_actual_review_and_later_states_are_preserved
    %w[IN_REVIEW CANCELING COMPLETING NEW_APPLE_STATE].each do |state|
      @api.state = state
      assert_raises(ReleasePipeline::Deferred) { @coordinator.plan([@api.version], "1.1.0") }
    end
    assert_empty @api.writes
  end

  def test_review_starting_during_replacement_preflight_is_preserved
    @api.advance_on_last_read = true
    assert_raises(ReleasePipeline::Deferred) { @coordinator.replace!("1.1.1") }
    assert_empty @api.writes
  end

  def test_unrelated_or_reviewed_items_are_not_withdrawn
    @api.extra = true
    assert_raises(ReleasePipeline::Deferred) { @coordinator.replace!("1.1.1") }
    @api.extra = false
    @api.item_state = "ACCEPTED"
    assert_raises(ReleasePipeline::Deferred) { @coordinator.replace!("1.1.1") }
    assert_empty @api.writes
  end

  def test_purchase_review_start_and_newer_source_each_prevent_withdrawal
    @api.purchase_state = "IN_REVIEW"
    assert_raises(ReleasePipeline::Deferred) { @coordinator.replace!("1.1.1") }
    @api.purchase_state = "WAITING_FOR_REVIEW"
    assert_raises(ReleasePipeline::Superseded) do
      @coordinator.replace!("1.1.1", before_cancel: -> { raise ReleasePipeline::Superseded })
    end
    assert_empty @api.writes
  end

  def test_apple_conflict_is_not_retried_and_defers_active_review
    @api.cancel_error = true
    assert_raises(ReleasePipeline::Deferred) { @coordinator.replace!("1.1.1") }
    assert_equal 1, @api.writes.length
  end

  def test_cancellation_timeout_never_continues_to_metadata_or_submission
    @api.complete_cancel = false
    assert_raises(ReleasePipeline::Deferred) { @coordinator.replace!("1.1.1") }
    assert_equal 1, @api.writes.length
  end
end
