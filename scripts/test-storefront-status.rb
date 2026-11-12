require "minitest/autorun"
require "ostruct"
require_relative "storefront-status"

class StorefrontStatusTest < Minitest::Test
  def check(
    page_code: "200",
    body: "Tendr: Dose & Weight Journal",
    version: "1.1.1",
    state: "READY_FOR_DISTRIBUTION",
    review_state: "COMPLETE"
  )
    api = Object.new
    api.define_singleton_method(:get) do |path|
      data =
        if path.include?("reviewSubmissions")
          [{ "attributes" => { "state" => review_state } }]
        else
          [
            {
              "attributes" => {
                "versionString" => "1.1.1",
                "appVersionState" => state
              }
            }
          ]
        end
      OpenStruct.new(body: { "data" => data })
    end
    fetch =
      lambda do |uri|
        if uri.host == "itunes.apple.com"
          OpenStruct.new(
            body:
              JSON.generate(
                {
                  results: [
                    {
                      trackId: 123,
                      version: version,
                      trackViewUrl: "https://apps.apple.com/us/app/id123"
                    }
                  ]
                }
              )
          )
        else
          response =
            (page_code == "200" ? Net::HTTPOK : Net::HTTPNotFound).new(
              "1.1",
              page_code,
              "response"
            )
          response.define_singleton_method(:body) { body }
          response
        end
      end
    StorefrontStatus.check(
      api,
      { "apple_id" => "123", "name" => "Tendr" },
      fetch: fetch
    )
  end

  def test_canonical_redirects_are_followed_without_leaving_apple
    redirect = Net::HTTPMovedPermanently.new("1.1", "301", "Moved")
    redirect["location"] = "/us/iphone/app/id123"
    ok = Net::HTTPOK.new("1.1", "200", "OK")
    visited = []
    request =
      lambda do |uri|
        visited << uri.path
        visited.length == 1 ? redirect : ok
      end
    assert_same ok,
                StorefrontStatus.http(
                  URI("https://apps.apple.com/us/app/id123"),
                  request: request
                )
    assert_equal %w[/us/app/id123 /us/iphone/app/id123], visited
    redirect["location"] = "https://unrelated.invalid/"
    assert_raises(RuntimeError) do
      StorefrontStatus.http(
        URI("https://apps.apple.com/us/app/id123"),
        request: ->(_) { redirect }
      )
    end
  end

  def test_lookup_entry_cannot_hide_public_404
    error = assert_raises(RuntimeError) { check(page_code: "404") }
    assert_includes error.message, "HTTP 404"
  end

  def test_stale_version_or_error_page_cannot_claim_live
    assert_raises(RuntimeError) { check(version: "1.1.0") }
    assert_raises(RuntimeError) do
      check(body: "Tendr — The page you're looking for can't be found")
    end
  end

  def test_review_is_reported_as_pending_and_cannot_resume_queue
    result = check(state: "IN_REVIEW")
    refute result.fetch(:idle)
    assert_includes result.fetch(:summary), "pending"
  end

  def test_both_public_sources_required
    assert check.fetch(:idle)
  end

  def test_waiting_can_resume_a_replacement_without_claiming_public_availability
    result =
      check(state: "WAITING_FOR_REVIEW", review_state: "WAITING_FOR_REVIEW")
    refute result.fetch(:idle)
    assert result.fetch(:resumable)
    result = check(state: "IN_REVIEW", review_state: "IN_REVIEW")
    refute result.fetch(:resumable)
    refute check(state: "WAITING_FOR_REVIEW", review_state: "CANCELING").fetch(
             :resumable
           )
    refute check(
             state: "WAITING_FOR_REVIEW",
             review_state: "NEW_APPLE_STATE"
           ).fetch(:resumable)
  end

  def test_a_deferred_withdrawal_can_resume_when_editable
    assert check(state: "DEVELOPER_REJECTED").fetch(:resumable)
    assert check(state: "PREPARE_FOR_SUBMISSION").fetch(:resumable)
  end

  def test_live_app_does_not_hide_pending_or_rejected_purchase_review
    result = check(review_state: "IN_REVIEW")
    refute result.fetch(:idle)
    assert_includes result.fetch(:summary), "purchase review pending"
    error =
      assert_raises(RuntimeError) { check(review_state: "UNRESOLVED_ISSUES") }
    assert_includes error.message, "unresolved issues"
  end

  def test_rejection_requires_action
    assert_raises(RuntimeError) { check(state: "REJECTED") }
    assert_raises(RuntimeError) do
      check(state: "REJECTED", review_state: "IN_REVIEW")
    end
  end
end
