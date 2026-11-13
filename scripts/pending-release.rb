require_relative "release-pipeline"

# The automatic publisher owns only app/purchase bundles carrying its source marker.
# Preparation is read-only; withdrawal happens after replacement evidence is ready.
class PendingRelease
  RELATIONS = {
    "appStoreVersion" => "appStoreVersions",
    "inAppPurchaseVersion" => "inAppPurchaseVersions",
    "subscriptionVersion" => "subscriptionVersions",
    "subscriptionGroupVersion" => "subscriptionGroupVersions"
  }.freeze

  def initialize(
    asc,
    app_id,
    source,
    ancestor:,
    sleeper: ->(seconds) { sleep seconds }
  )
    @asc, @app_id, @source, @ancestor, @sleeper =
      asc,
      app_id,
      source,
      ancestor,
      sleeper
  end

  def plan(versions, configured)
    versions
      .select { |v| ReleasePipeline.state(v) == "IN_REVIEW" }
      .each do |version|
        if source_for(version.fetch("id")) == @source
          raise ReleasePipeline::AlreadySubmitted,
                "This source is already in review"
        end
      end
    waiting = waiting_review
    target, id =
      ReleasePipeline.version(versions, configured, allow_waiting: true)
    if waiting
      unless id
        raise ReleasePipeline::Deferred,
              "Waiting review does not match the planned app version"
      end
      validate!(waiting, id)
    elsif versions.any? { |v| ReleasePipeline.state(v) == "WAITING_FOR_REVIEW" }
      raise ReleasePipeline::Deferred,
            "Waiting app has no matching review submission"
    end
    [target, id]
  end

  def replace!(target, before_cancel: -> {})
    review = waiting_review
    return [] unless review
    items = targets!(review.fetch("id"))
    apps = items.select { |relation, _, _| relation == "appStoreVersion" }
    unless apps.one?
      raise ReleasePipeline::Deferred,
            "Waiting bundle must contain exactly one app version"
    end
    id = apps.first.last
    version = @asc.get("v1/appStoreVersions/#{id}").body.fetch("data")
    unless version.dig("attributes", "versionString") == target
      raise ReleasePipeline::Deferred, "Waiting release version changed"
    end
    required = validate!(review, id)
    before_cancel.call
    # Read the submission last: Apple has no conditional cancellation endpoint.
    current =
      @asc.get("v1/reviewSubmissions/#{review.fetch("id")}").body.fetch("data")
    require_waiting!(current)
    begin
      @asc.patch(
        "v1/reviewSubmissions/#{review.fetch("id")}",
        {
          data: {
            type: "reviewSubmissions",
            id: review.fetch("id"),
            attributes: {
              canceled: true
            }
          }
        }
      )
    rescue StandardError
      # Never retry an ambiguous cancellation. Preserve review if Apple won the race.
      require_waiting!(
        @asc
          .get("v1/reviewSubmissions/#{review.fetch("id")}")
          .body
          .fetch("data")
      )
      raise
    end
    40.times do
      state =
        @asc
          .get("v1/reviewSubmissions/#{review.fetch("id")}")
          .body
          .dig("data", "attributes", "state")
      version = @asc.get("v1/appStoreVersions/#{id}").body.fetch("data")
      if state == "COMPLETE" &&
           ReleasePipeline::EDITABLE.include?(ReleasePipeline.state(version))
        return required
      end
      if state == "IN_REVIEW"
        raise ReleasePipeline::Deferred,
              "Review began during cancellation; leaving it untouched"
      end
      @sleeper.call(3)
    end
    raise ReleasePipeline::Deferred,
          "Withdrawal still processing; replacement must wait for an editable version"
  end

  def waiting_review
    # Unknown states fail closed. Completed submissions remain historical records.
    active =
      ReleasePipeline
        .reviews(@asc, @app_id)
        .reject do |row|
          %w[COMPLETE READY_FOR_REVIEW UNRESOLVED_ISSUES].include?(
            row.dig("attributes", "state")
          )
        end
    return nil if active.empty?
    unless active.one?
      raise ReleasePipeline::Deferred,
            "Another review is active; queue the latest source"
    end
    require_waiting!(active.first)
    active.first
  end

  def require_waiting!(row)
    unless row.dig("attributes", "state") == "WAITING_FOR_REVIEW"
      raise ReleasePipeline::Deferred,
            "Apple review has started or changed; queue the latest source"
    end
  end

  def targets!(submission_id)
    rows =
      ReleasePipeline.all(
        @asc,
        "v1/reviewSubmissions/#{submission_id}/items?include=#{RELATIONS.keys.join(",")}&limit=200"
      )
    rows
      .reject { |row| row.dig("attributes", "state") == "REMOVED" }
      .map do |item|
        unless item.dig("attributes", "state") == "READY_FOR_REVIEW"
          raise ReleasePipeline::Deferred,
                "A review item has already been reviewed; preserve the bundle"
        end
        links =
          item
            .fetch("relationships")
            .filter_map do |relation, value|
              data = value["data"]
              [relation, data["type"], data["id"]] if data.is_a?(Hash)
            end
        unless links.one? && RELATIONS[links.first[0]] == links.first[1] &&
                 links.first[2]
          raise ReleasePipeline::Deferred,
                "Waiting submission contains an unrelated review item; preserve it"
        end
        links.first
      end
  end

  def validate!(review, version_id)
    require_waiting!(
      @asc.get("v1/reviewSubmissions/#{review.fetch("id")}").body.fetch("data")
    )
    targets = targets!(review.fetch("id"))
    app_targets =
      targets.select { |relation, _, _| relation == "appStoreVersion" }
    unless app_targets == [["appStoreVersion", "appStoreVersions", version_id]]
      raise ReleasePipeline::Deferred,
            "Waiting review belongs to another app version"
    end
    targets
      .reject { |relation, _, _| relation == "appStoreVersion" }
      .each do |_, type, id|
        state =
          @asc.get("v1/#{type}/#{id}").body.dig("data", "attributes", "state")
        unless state == "WAITING_FOR_REVIEW"
          raise ReleasePipeline::Deferred,
                "A purchase version is no longer waiting; preserve the bundle"
        end
      end
    version = @asc.get("v1/appStoreVersions/#{version_id}").body.fetch("data")
    unless ReleasePipeline.state(version) == "WAITING_FOR_REVIEW"
      raise ReleasePipeline::Deferred, "App version is no longer waiting"
    end
    source = source_for(version_id)
    unless source
      raise ReleasePipeline::Deferred,
            "Waiting build is not owned by the automatic pipeline"
    end
    if source == @source
      raise ReleasePipeline::AlreadySubmitted,
            "This source is already waiting for review"
    end
    unless @ancestor.call(source, @source)
      raise ReleasePipeline::Deferred,
            "Waiting build is newer or unrelated; preserve it"
    end
    targets
  end

  def source_for(version_id)
    build =
      @asc.get("v1/appStoreVersions/#{version_id}/build").body.fetch("data")
    return nil unless build
    notes =
      ReleasePipeline.all(
        @asc,
        "v1/builds/#{build.fetch("id")}/betaBuildLocalizations?limit=200"
      )
    sources =
      notes
        .filter_map do |row|
          row
            .dig("attributes", "whatsNew")
            .to_s
            .match(/\ABuild from main \(([a-f0-9]{40})\)\z/)
            &.captures
            &.first
        end
        .uniq
    sources.first if sources.one?
  end
end
