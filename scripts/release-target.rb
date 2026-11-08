# Resolve manual inputs or an immutable app-store/<app>/<version>-<build> tag.
require "yaml"
require_relative "release-build"

if ENV["GITHUB_REF_TYPE"] == "tag"
  match = ENV.fetch("GITHUB_REF_NAME").match(/\Aapp-store\/(?:(?<app>[a-z][a-z0-9-]*)\/)?(?<version>\d+\.\d+(?:\.\d+)?)-(?<build>[1-9]\d*)\z/)
  abort("Use app-store/<app>/<version>-<build>, for example app-store/tendr/1.1.0-29") unless match
  app, version, build = match[:app] || "tendr", match[:version], match[:build]
else
  app, version, build = ENV.fetch("INPUT_APP", "tendr"), ENV["INPUT_VERSION"].to_s, ENV["INPUT_BUILD"]
end
abort("Invalid app slug") unless app.match?(/\A[a-z][a-z0-9-]*\z/)
path = File.expand_path("../apps/#{app}/app.yml", __dir__)
abort("Unknown app #{app}") unless File.file?(path)
version = YAML.safe_load_file(path).fetch("version").to_s if version.empty?
abort("Invalid release version") unless version.match?(/\A\d+\.\d+(?:\.\d+)?\z/)
build = ReleaseBuild.number!(build)
output = "app=#{app}\nversion=#{version}\nbuild=#{build}\n"
puts output
File.write(ENV.fetch("GITHUB_OUTPUT"), output, mode: "a") if ENV["GITHUB_OUTPUT"]
