# Shared by release preparation and submission. Never falls back to the newest build.
module ReleaseBuild
  def self.number!(value)
    number = value.to_s
    raise ArgumentError, "Pass an explicit build number (build:29 / BUILD_NUMBER=29)" unless number.match?(/\A[1-9]\d*\z/)
    number
  end

  def self.find!(asc, app_id, version, value)
    number = number!(value)
    response = asc.get("v1/builds", {
      "filter[app]" => app_id, "filter[preReleaseVersion.version]" => version,
      "filter[version]" => number, "filter[processingState]" => "VALID",
      "filter[expired]" => "false", "limit" => 200
    }).body
    builds = response.fetch("data")
    while (next_url = response.dig("links", "next"))
      response = asc.get(next_url).body
      builds += response.fetch("data")
    end
    matches = builds.select do |build|
      attributes = build.fetch("attributes")
      attributes["version"] == number && attributes["processingState"] == "VALID" && attributes["expired"] == false
    end
    raise ArgumentError, "Expected one processed, unexpired #{version} (#{number}) build; found #{matches.length}. Wait for processing and check the app/version/build." unless matches.one?
    matches.first
  end
end
