require "minitest/autorun"
require_relative "testflight_feedback"

class TestflightFeedbackTest < Minitest::Test
  Response = Struct.new(:body)

  def test_enables_disabled_group_and_confirms_readback
    api = FakeAPI.new(false, true)
    TestflightFeedback.ensure_enabled!(client: Struct.new(:test_flight_request_client).new(api), group_id: "group1")
    assert_equal 1, api.patches.length
    assert_equal true, api.patches.first.dig(:data, :attributes, :feedbackEnabled)
  end

  def test_enabled_group_does_not_mutate
    api = FakeAPI.new(true)
    TestflightFeedback.ensure_enabled!(client: Struct.new(:test_flight_request_client).new(api), group_id: "group1")
    assert_empty api.patches
  end

  def test_failed_readback_stops_distribution
    api = FakeAPI.new(false, false)
    assert_raises(RuntimeError) do
      TestflightFeedback.ensure_enabled!(client: Struct.new(:test_flight_request_client).new(api), group_id: "group1")
    end
  end

  class FakeAPI
    attr_reader :patches

    def initialize(*values)
      @values = values
      @patches = []
    end

    def get(path)
      raise "Wrong group" unless path == "v1/betaGroups/group1"
      Response.new({"data" => {"type" => "betaGroups", "id" => "group1", "attributes" => {"feedbackEnabled" => @values.shift}}})
    end

    def patch(path, body)
      raise "Wrong group" unless path == "v1/betaGroups/group1"
      @patches << body
    end
  end
end
