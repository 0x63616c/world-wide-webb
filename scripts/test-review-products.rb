require "minitest/autorun"
require "ostruct"
require_relative "review-products"

class ReviewProductsTest < Minitest::Test
  class API
    attr_reader :writes, :rows
    attr_accessor :product_state, :submission_state
    def initialize
      @writes = []
      @rows = [{ "id" => "app-item", "attributes" => { "state" => "REJECTED" }, "relationships" => { "appStoreVersion" => { "data" => { "id" => "app-version" } } } }]
      @product_state, @submission_state = "READY_TO_SUBMIT", "READY_FOR_REVIEW"
    end
    def get(path, params = nil)
      data = case path
      when 'v1/apps/app/inAppPurchasesV2'
        [{ "id" => "tip", "attributes" => { "productId" => "tip.small", "state" => product_state } }]
      when 'v2/inAppPurchases/tip/versions'
        [{ "id" => "tip-version", "attributes" => { "state" => "PREPARE_FOR_SUBMISSION" } }]
      when 'v1/apps/app/subscriptionGroups' then []
      when 'v1/reviewSubmissions'
        [{ "id" => "review", "attributes" => { "state" => submission_state } }]
      when 'v1/reviewSubmissions/review/items' then rows
      when 'v1/reviewSubmissions/review' then { 'attributes' => { 'state' => submission_state } }
      when /Versions\// then { "attributes" => { "state" => "WAITING_FOR_REVIEW" } }
      else raise "Unexpected GET #{path}"
      end
      OpenStruct.new(body: { "data" => data })
    end
    def post(path, body)
      if path == 'v1/reviewSubmissions'
        @writes << [path, body]
        @submission_state = 'READY_FOR_REVIEW'
        @rows = []
        return OpenStruct.new(body: { 'data' => { 'id' => 'review' } })
      end
      raise "Unexpected POST #{path}" unless path == 'v1/reviewSubmissionItems' 
      @writes << [path, body]
      data = JSON.parse(JSON.generate(body[:data]))
      data['id'] = 'tip-item'
      data['attributes'] = { 'state' => 'READY_FOR_REVIEW' }
      @rows << data
      OpenStruct.new(body: { 'data' => data })
    end
    def patch(path, body)
      @writes << [path, body]
      @submission_state = 'COMPLETE' if body.dig(:data, :attributes, :removed)
      OpenStruct.new(body: { 'data' => { 'attributes' => { 'state' => 'WAITING_FOR_REVIEW' } } })
    end
  end
  def setup
    require 'json'
    @api = API.new
    @review = ReviewProducts.new(@api, 'app', 'app-version')
  end
  def test_inventory_is_read_only
    @review.inventory!
    assert_empty @api.writes
    assert_equal 2, @review.targets.length
  end
  def test_attach_before_resolving_and_submitting
    @review.inventory!.submit!
    assert_equal ['v1/reviewSubmissionItems', 'v1/reviewSubmissionItems/app-item', 'v1/reviewSubmissions/review'], @api.writes.map(&:first)
  end
  def test_rejected_submission_is_rebuilt_before_adding_missing_products
    @api.submission_state = 'UNRESOLVED_ISSUES'
    @review.inventory!.submit!
    assert_equal ['v1/reviewSubmissionItems/app-item', 'v1/reviewSubmissions', 'v1/reviewSubmissionItems', 'v1/reviewSubmissionItems', 'v1/reviewSubmissions/review'], @api.writes.map(&:first)
    assert_equal true, @api.writes.first.last.dig(:data, :attributes, :removed)
  end
  def test_retry_does_not_duplicate_items
    @review.inventory!.submit!
    @api.writes.clear
    @review.inventory!.submit!
    refute @api.writes.any? { |path, _| path == 'v1/reviewSubmissionItems' }
  end
  def test_missing_metadata_stops_without_price_or_product_changes
    @api.product_state = 'MISSING_METADATA'
    assert_raises(RuntimeError) { @review.inventory! }
    assert_empty @api.writes
  end
  def test_pending_review_is_not_withdrawn
    @api.submission_state = 'WAITING_FOR_REVIEW'
    assert_raises(RuntimeError) { @review.inventory! }
    assert_empty @api.writes
  end
  def test_unrelated_item_is_not_submitted
    @api.rows << { 'id' => 'other', 'attributes' => { 'state' => 'READY_FOR_REVIEW' }, 'relationships' => {} }
    assert_raises(RuntimeError) { @review.inventory! }
    assert_empty @api.writes
  end

  def test_withdrawn_purchase_cannot_disappear_from_replacement
    required = [["inAppPurchaseVersion", "inAppPurchaseVersions", "another-tip-version"]]
    review = ReviewProducts.new(@api, 'app', 'app-version', required_targets: required)
    assert_raises(RuntimeError) { review.inventory! }
    assert_empty @api.writes
  end

  def test_newer_merge_during_assembly_prevents_submission
    fence = -> { raise "Newer source supersedes this release" }
    review = ReviewProducts.new(@api, 'app', 'app-version', before_submit: fence)
    assert_raises(RuntimeError) { review.inventory!.submit! }
    refute @api.writes.any? { |_, body| body.dig(:data, :attributes, :submitted) }
  end
end
