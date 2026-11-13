# App Store Connect owns screenshot feedback per TestFlight group, not per app build.
module TestflightFeedback
  def self.ensure_enabled!(client:, group_id:)
    raise "TestFlight group ID is required" if group_id.to_s.empty?

    api = client.test_flight_request_client
    path = "v1/betaGroups/#{group_id}"
    enabled = feedback_enabled(api.get(path), group_id)
    return if enabled

    api.patch(
      path,
      {
        data: {
          type: "betaGroups",
          id: group_id,
          attributes: {
            feedbackEnabled: true
          }
        }
      }
    )
    unless feedback_enabled(api.get(path), group_id)
      raise "TestFlight screenshot feedback remains disabled for group #{group_id}"
    end
  end

  def self.feedback_enabled(response, group_id)
    data = response.body.fetch("data")
    unless data.fetch("type") == "betaGroups" && data.fetch("id") == group_id
      raise "Unexpected TestFlight group response"
    end

    value = data.fetch("attributes").fetch("feedbackEnabled")
    unless value == true || value == false
      raise "Missing TestFlight feedback setting"
    end

    value
  end
  private_class_method :feedback_enabled
end
