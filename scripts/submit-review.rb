# Submits an app's editable App Store version for App Review through the App Store Connect API.
# Optionally cancels a submission that is still WAITING_FOR_REVIEW first, moves the editable version to
# VERSION (default: app.yml version), attaches the explicit BUILD_NUMBER for that version, sets "What's New"
# and submits. Prints greppable lines (CANCEL:, VERSION:, BUILD:, WHATSNEW:, SUBMIT:).
# Usage: ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_CONTENT=… BUILD_NUMBER=29 DRY_RUN=true bundle exec ruby scripts/submit-review.rb <app>
require "spaceship"
require "yaml"
require_relative "release-build"
require_relative "release-policy"

APP = ARGV.first || ENV["APP"] || abort("usage: submit-review.rb <app>")
abort("Invalid app slug") unless APP.match?(/\A[a-z][a-z0-9-]*\z/)
CONFIG =
  YAML.safe_load(
    File.read(File.expand_path("../projects/#{APP}/app.yml", __dir__))
  )
APP_ID = CONFIG["apple_id"].to_s
abort("Set apple_id in projects/#{APP}/app.yml") if APP_ID.empty?
TARGET =
  (ENV["VERSION"].to_s.empty? ? CONFIG.fetch("version") : ENV["VERSION"]).to_s
BUILD_NUMBER = ReleaseBuild.number!(ENV["BUILD_NUMBER"])
DRY_RUN = ENV["DRY_RUN"] == "true"
EDITABLE = %w[
  PREPARE_FOR_SUBMISSION
  DEVELOPER_REJECTED
  REJECTED
  METADATA_REJECTED
  INVALID_BINARY
].freeze

Spaceship::ConnectAPI.auth(
  key_id: ENV.fetch("ASC_KEY_ID"),
  issuer_id: ENV.fetch("ASC_ISSUER_ID"),
  key: ENV.fetch("ASC_KEY_CONTENT")
)
asc = Spaceship::ConnectAPI.client.tunes_request_client
# Resolve before any cancellation or version/metadata mutation.
build = ReleaseBuild.find!(asc, APP_ID, TARGET, BUILD_NUMBER)

def versions(asc)
  asc.get(
    "v1/projects/#{APP_ID}/appStoreVersions",
    { "filter[platform]" => "IOS", "limit" => 50 }
  ).body[
    "data"
  ]
end

def state(version)
  version.dig("attributes", "appVersionState") ||
    version.dig("attributes", "appStoreState")
end

versions(asc).each do |v|
  puts "BEFORE: #{v.dig("attributes", "versionString")} #{state(v)}"
end

submissions =
  asc.get(
    "v1/reviewSubmissions",
    { "filter[app]" => APP_ID, "filter[platform]" => "IOS", "limit" => 20 }
  ).body[
    "data"
  ]
waiting =
  submissions.select do |s|
    s.dig("attributes", "state") == "WAITING_FOR_REVIEW"
  end
in_review =
  submissions.select { |s| s.dig("attributes", "state") == "IN_REVIEW" }
abort("A submission is IN_REVIEW; not touching it.") unless in_review.empty?

unless waiting.empty?
  unless ENV["CANCEL_WAITING"] == "true"
    abort(
      "Submission #{waiting.map { |s| s["id"] }.join(", ")} is WAITING_FOR_REVIEW; set CANCEL_WAITING=true to cancel it"
    )
  end
  waiting.each do |submission|
    if DRY_RUN
      puts "CANCEL: dry run, would cancel #{submission["id"]}"
      next
    end
    asc.patch(
      "v1/reviewSubmissions/#{submission["id"]}",
      {
        data: {
          type: "reviewSubmissions",
          id: submission["id"],
          attributes: {
            canceled: true
          }
        }
      }
    )
    20.times do
      current =
        asc
          .get("v1/reviewSubmissions/#{submission["id"]}")
          .body
          .dig("data", "attributes", "state")
      puts "CANCEL: #{submission["id"]} #{current}"
      break if current == "COMPLETE"
      sleep 6
    end
  end
  sleep 5
end

version = versions(asc).find { |v| EDITABLE.include?(state(v)) }
unless version
  abort(
    "No editable App Store version (#{versions(asc).map { |v| state(v) }.join(", ")}). Create one in App Store Connect."
  )
end
if version.dig("attributes", "versionString") != TARGET
  puts "VERSION: #{version.dig("attributes", "versionString")} -> #{TARGET}"
  unless DRY_RUN
    asc.patch(
      "v1/appStoreVersions/#{version["id"]}",
      {
        data: {
          type: "appStoreVersions",
          id: version["id"],
          attributes: {
            versionString: TARGET
          }
        }
      }
    )
  end
else
  puts "VERSION: #{TARGET} already set"
end

puts "BUILD: #{TARGET} (#{build.dig("attributes", "version")}) uploaded #{build.dig("attributes", "uploadedDate")} id #{build["id"]}"
unless DRY_RUN
  asc.patch(
    "v1/appStoreVersions/#{version["id"]}/relationships/build",
    { data: { type: "builds", id: build["id"] } }
  )
end

notes = ENV["WHATS_NEW"].to_s.strip
unless notes.empty?
  begin
    locs =
      asc.get(
        "v1/appStoreVersions/#{version["id"]}/appStoreVersionLocalizations"
      ).body[
        "data"
      ]
    loc =
      locs.find { |l| l.dig("attributes", "locale") == "en-US" } || locs.first
    unless DRY_RUN
      asc.patch(
        "v1/appStoreVersionLocalizations/#{loc["id"]}",
        {
          data: {
            type: "appStoreVersionLocalizations",
            id: loc["id"],
            attributes: {
              whatsNew: notes
            }
          }
        }
      )
    end
    puts "WHATSNEW: set (#{notes.length} chars)"
  rescue StandardError => error
    puts "WHATSNEW: not set (#{error.message.lines.first&.strip}); keeping existing release notes"
  end
end

if DRY_RUN
  puts "SUBMIT: dry run, stopping before submission"
  exit
end

ReleasePolicy.apply!(asc, CONFIG, version.fetch("id"))

submission =
  submissions.find { |s| s.dig("attributes", "state") == "READY_FOR_REVIEW" }
submission ||=
  asc.post(
    "v1/reviewSubmissions",
    {
      data: {
        type: "reviewSubmissions",
        attributes: {
          platform: "IOS"
        },
        relationships: {
          app: {
            data: {
              type: "apps",
              id: APP_ID
            }
          }
        }
      }
    }
  ).body[
    "data"
  ]
items =
  asc.get(
    "v1/reviewSubmissions/#{submission["id"]}/items",
    { "limit" => 50 }
  ).body[
    "data"
  ]
if items.empty?
  asc.post(
    "v1/reviewSubmissionItems",
    {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: {
            data: {
              type: "reviewSubmissions",
              id: submission["id"]
            }
          },
          appStoreVersion: {
            data: {
              type: "appStoreVersions",
              id: version["id"]
            }
          }
        }
      }
    }
  )
end
result =
  asc.patch(
    "v1/reviewSubmissions/#{submission["id"]}",
    {
      data: {
        type: "reviewSubmissions",
        id: submission["id"],
        attributes: {
          submitted: true
        }
      }
    }
  ).body
puts "SUBMIT: #{result.dig("data", "attributes", "state")} submission #{submission["id"]} version #{TARGET} build #{build.dig("attributes", "version")}"
versions(asc).each do |v|
  puts "AFTER: #{v.dig("attributes", "versionString")} #{state(v)}"
end
