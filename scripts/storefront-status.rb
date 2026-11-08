# Read-only monitor: approval, listing API and public product page are distinct evidence.
require "yaml"
require "json"
require "net/http"
require_relative "release-pipeline"

module StorefrontStatus
  def self.http(uri, request: ->(target) { Net::HTTP.get_response(target) })
    6.times do
      raise "Unexpected public storefront destination" unless uri.scheme == "https" && %w[apps.apple.com itunes.apple.com].include?(uri.host)
      response = request.call(uri)
      return response unless response.is_a?(Net::HTTPRedirection)
      uri = URI.join(uri.to_s, response.fetch("location"))
    end
    raise "Too many storefront redirects"
  end

  def self.check(asc, config, fetch: ->(uri) { http(uri) })
    versions = ReleasePipeline.all(asc, "v1/apps/#{config.fetch('apple_id')}/appStoreVersions?filter[platform]=IOS&limit=50")
    latest = versions.max_by { |v| Gem::Version.new(v.dig("attributes", "versionString")) } || raise("No App Store versions")
    state = ReleasePipeline.state(latest)
    version = latest.dig("attributes", "versionString")
    summary = "Tendr #{version}: #{state}."
    if %w[REJECTED METADATA_REJECTED INVALID_BINARY DEVELOPER_REJECTED PENDING_DEVELOPER_RELEASE].include?(state)
      raise("#{summary} Action needed in App Store Connect; automatic publication has not completed")
    end
    reviews = ReleasePipeline.reviews(asc, config.fetch("apple_id"))
    if reviews.any? { |row| row.dig("attributes", "state") == "UNRESOLVED_ISSUES" }
      raise("#{summary} Joint app/purchase review has unresolved issues; action needed in App Store Connect")
    end
    if reviews.any? { |row| ReleasePipeline::ACTIVE_REVIEW.include?(row.dig("attributes", "state")) }
      return { idle: false, summary: "#{summary} Joint app/purchase review pending; no public-availability claim." }
    end
    if ReleasePipeline::LIVE.include?(state)
      %w[us gb].each do |country|
        lookup_uri = URI("https://itunes.apple.com/lookup?id=#{config.fetch('apple_id')}&country=#{country}")
        lookup = JSON.parse(fetch.call(lookup_uri).body).fetch("results")
        record = lookup.find { |r| r["trackId"].to_s == config.fetch("apple_id").to_s && r["version"] == version }
        raise("#{summary} #{country}: public listing API has not published this version") unless record
        # Use Apple's canonical URL; validate the destination before requesting it.
        uri = URI(record.fetch("trackViewUrl"))
        raise("Unexpected storefront URL") unless uri.scheme == "https" && uri.host == "apps.apple.com"
        response = fetch.call(uri)
        body = response.body.to_s
        raise("#{summary} #{country}: public page unavailable (HTTP #{response.code}); listing API alone is insufficient") unless response.is_a?(Net::HTTPSuccess) && body.include?(config.fetch("name")) && !body.include?("can't be found") && !body.include?("can’t be found")
        summary += " #{country}: public page and listing API verified."
      end
    else
      summary += " Publication pending; no public-availability claim."
    end
    { idle: ReleasePipeline::LIVE.include?(state), summary: summary }
  end
end

if $PROGRAM_NAME == __FILE__
  require "spaceship"
  config = YAML.safe_load_file(File.expand_path("../apps/tendr/app.yml", __dir__))
  Spaceship::ConnectAPI.auth(key_id: ENV.fetch("ASC_KEY_ID"), issuer_id: ENV.fetch("ASC_ISSUER_ID"), key: ENV.fetch("ASC_KEY_CONTENT"))
  result = StorefrontStatus.check(Spaceship::ConnectAPI.client.tunes_request_client, config)
  puts result.fetch(:summary)
  File.open(ENV.fetch("GITHUB_OUTPUT"), "a") { |f| f.puts("idle=#{result.fetch(:idle)}") } if ENV["GITHUB_OUTPUT"]
  File.open(ENV.fetch("GITHUB_STEP_SUMMARY"), "a") { |f| f.puts(result.fetch(:summary)) } if ENV["GITHUB_STEP_SUMMARY"]
end
