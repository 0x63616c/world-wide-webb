# Read-only monitor: approval, listing API and public product page are distinct evidence.
require "yaml"
require "json"
require "net/http"
require_relative "release-pipeline"

module StorefrontStatus
  def self.http(uri, request: ->(target) { Net::HTTP.get_response(target) })
    6.times do
      unless uri.scheme == "https" &&
               %w[apps.apple.com itunes.apple.com].include?(uri.host)
        raise "Unexpected public storefront destination"
      end
      response = request.call(uri)
      return response unless response.is_a?(Net::HTTPRedirection)
      uri = URI.join(uri.to_s, response.fetch("location"))
    end
    raise "Too many storefront redirects"
  end

  def self.check(asc, config, fetch: ->(uri) { http(uri) })
    versions =
      ReleasePipeline.all(
        asc,
        "v1/apps/#{config.fetch("apple_id")}/appStoreVersions?filter[platform]=IOS&limit=50"
      )
    latest =
      versions.max_by do |v|
        Gem::Version.new(v.dig("attributes", "versionString"))
      end || raise("No App Store versions")
    state = ReleasePipeline.state(latest)
    version = latest.dig("attributes", "versionString")
    summary = "Tendr #{version}: #{state}."
    if %w[
         REJECTED
         METADATA_REJECTED
         INVALID_BINARY
         PENDING_DEVELOPER_RELEASE
       ].include?(state)
      raise(
        "#{summary} Action needed in App Store Connect; automatic publication has not completed"
      )
    end
    reviews = ReleasePipeline.reviews(asc, config.fetch("apple_id"))
    if reviews.any? { |row|
         row.dig("attributes", "state") == "UNRESOLVED_ISSUES"
       }
      raise(
        "#{summary} Joint app/purchase review has unresolved issues; action needed in App Store Connect"
      )
    end
    active =
      reviews.reject do |row|
        %w[COMPLETE READY_FOR_REVIEW].include?(row.dig("attributes", "state"))
      end
    unless active.empty?
      waiting =
        state == "WAITING_FOR_REVIEW" && active.one? &&
          active.first.dig("attributes", "state") == "WAITING_FOR_REVIEW"
      return(
        {
          idle: false,
          resumable: waiting,
          summary:
            "#{summary} Joint app/purchase review pending; no public-availability claim."
        }
      )
    end
    if ReleasePipeline::LIVE.include?(state)
      %w[us gb].each do |country|
        lookup_uri =
          URI(
            "https://itunes.apple.com/lookup?id=#{config.fetch("apple_id")}&country=#{country}"
          )
        lookup = JSON.parse(fetch.call(lookup_uri).body).fetch("results")
        record =
          lookup.find do |r|
            r["trackId"].to_s == config.fetch("apple_id").to_s &&
              r["version"] == version
          end
        unless record
          raise(
            "#{summary} #{country}: public listing API has not published this version"
          )
        end
        # Use Apple's canonical URL; validate the destination before requesting it.
        uri = URI(record.fetch("trackViewUrl"))
        unless uri.scheme == "https" && uri.host == "apps.apple.com"
          raise("Unexpected storefront URL")
        end
        response = fetch.call(uri)
        body = response.body.to_s
        unless response.is_a?(Net::HTTPSuccess) &&
                 body.include?(config.fetch("name")) &&
                 !body.include?("can't be found") &&
                 !body.include?("can’t be found")
          raise(
            "#{summary} #{country}: public page unavailable (HTTP #{response.code}); listing API alone is insufficient"
          )
        end
        summary += " #{country}: public page and listing API verified."
      end
    else
      summary += " Publication pending; no public-availability claim."
    end
    idle = ReleasePipeline::LIVE.include?(state)
    {
      idle: idle,
      resumable:
        idle || %w[PREPARE_FOR_SUBMISSION DEVELOPER_REJECTED].include?(state),
      summary: summary
    }
  end
end

if $PROGRAM_NAME == __FILE__
  require "spaceship"
  config =
    YAML.safe_load_file(File.expand_path("../apps/tendr/app.yml", __dir__))
  Spaceship::ConnectAPI.auth(
    key_id: ENV.fetch("ASC_KEY_ID"),
    issuer_id: ENV.fetch("ASC_ISSUER_ID"),
    key: ENV.fetch("ASC_KEY_CONTENT")
  )
  result =
    StorefrontStatus.check(
      Spaceship::ConnectAPI.client.tunes_request_client,
      config
    )
  puts result.fetch(:summary)
  if ENV["GITHUB_OUTPUT"]
    File.open(ENV.fetch("GITHUB_OUTPUT"), "a") do |f|
      f.puts("idle=#{result.fetch(:idle)}")
      f.puts("resumable=#{result.fetch(:resumable)}")
    end
  end
  if ENV["GITHUB_STEP_SUMMARY"]
    File.open(ENV.fetch("GITHUB_STEP_SUMMARY"), "a") do |f|
      f.puts(result.fetch(:summary))
    end
  end
end
