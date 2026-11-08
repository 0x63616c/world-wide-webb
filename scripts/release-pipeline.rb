require "json"
require "digest"
require "rubygems/version"

# Decisions and evidence required by automatic delivery, independent of fastlane.
module ReleasePipeline
  class Deferred < StandardError; end
  class Superseded < Deferred; end
  class AlreadySubmitted < StandardError; end

  EDITABLE = %w[PREPARE_FOR_SUBMISSION DEVELOPER_REJECTED REJECTED METADATA_REJECTED INVALID_BINARY].freeze
  LIVE = %w[READY_FOR_SALE READY_FOR_DISTRIBUTION].freeze
  ACTIVE_REVIEW = %w[WAITING_FOR_REVIEW IN_REVIEW CANCELING COMPLETING].freeze

  def self.reviews(asc, app_id)
    all(asc, "v1/reviewSubmissions?filter[app]=#{app_id}&filter[platform]=IOS&limit=50")
  end

  def self.require_idle_reviews!(submissions)
    active = submissions.select { |row| ACTIVE_REVIEW.include?(row.dig("attributes", "state")) }
    raise Deferred, "Joint app/purchase review already in progress; preserve it and retry after completion" unless active.empty?
  end

  def self.state(row)
    row.fetch("attributes")["appVersionState"] || row.fetch("attributes").fetch("appStoreState")
  end

  def self.version(versions, configured, allow_waiting: false)
    editable_states = EDITABLE + (allow_waiting ? ["WAITING_FOR_REVIEW"] : [])
    blocked = versions.reject { |v| (editable_states + LIVE + %w[REMOVED_FROM_SALE DEVELOPER_REMOVED_FROM_SALE REPLACED_WITH_NEW_VERSION]).include?(state(v)) }
    raise Deferred, "Release already in progress: #{blocked.map { |v| state(v) }.join(', ')}; preserve it and retry after completion" unless blocked.empty?
    editable = versions.select { |v| editable_states.include?(state(v)) }
    raise "Multiple editable iOS versions" if editable.length > 1
    return [editable.first.dig("attributes", "versionString"), editable.first.fetch("id")] if editable.one?
    latest = versions.map { |v| Gem::Version.new(v.dig("attributes", "versionString")) }.max
    target = Gem::Version.new(configured)
    if latest && target <= latest
      parts = latest.to_s.split(".").map(&:to_i)
      parts << 0 while parts.length < 3
      parts[-1] += 1
      target = Gem::Version.new(parts.join("."))
    end
    [target.to_s, nil]
  end

  def self.all(asc, path)
    rows = []
    while path
      body = asc.get(path).body
      rows.concat(body.fetch("data"))
      path = body.dig("links", "next")
    end
    rows
  end

  # Compare the uploaded files themselves, rather than accepting old screenshots
  # merely because a display gallery is populated. Apple uses MD5 for this field.
  def self.staged!(directory, duo_count)
    expected = Dir[File.join(directory, "*.png")].to_h { |p| [File.basename(p), Digest::MD5.file(p).hexdigest] }
    raise "No release screenshots staged" if expected.empty?
    raise "Expected #{duo_count} staged Duo images" unless expected.keys.count { |n| n.start_with?("duo-") } == duo_count && duo_count.positive?
    expected
  end

  def self.screenshots!(asc, version_id, directory, duo_count)
    expected = staged!(directory, duo_count)
    locales = all(asc, "v1/appStoreVersions/#{version_id}/appStoreVersionLocalizations")
    locale = locales.find { |l| l.dig("attributes", "locale") == "en-US" } || raise("Missing en-US listing")
    sets = all(asc, "v1/appStoreVersionLocalizations/#{locale.fetch('id')}/appScreenshotSets")
    uploaded = sets.flat_map do |set|
      all(asc, "v1/appScreenshotSets/#{set.fetch('id')}/appScreenshots").map do |shot|
        [shot, set.dig("attributes", "screenshotDisplayType")]
      end
    end
    expected.each do |name, checksum|
      matches = uploaded.select { |shot, _| shot.dig("attributes", "fileName") == name }
      raise "Missing or duplicate uploaded screenshot: #{name}" unless matches.one?
      shot, display = matches.first
      attrs = shot.fetch("attributes")
      raise "Screenshot not processed: #{name}" unless attrs.dig("assetDeliveryState", "state") == "COMPLETE"
      raise "Screenshot content mismatch: #{name}" unless attrs["sourceFileChecksum"].to_s.downcase == checksum
      raise "Duo image assigned to #{display}: #{name}" if name.start_with?("duo-") && display != "APP_IPHONE_DUO"
    end
    expected.length
  end
end
