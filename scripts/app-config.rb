# Reads apps/<app>/app.yml for shell scripts and workflows.
#   ruby scripts/app-config.rb tendr scheme        -> Still
#   ruby scripts/app-config.rb tendr project_path  -> apps/tendr/Still.xcodeproj
#   ruby scripts/app-config.rb --list              -> every app folder with an app.yml
#   ruby scripts/app-config.rb --list testflight   -> only apps whose app.yml sets testflight: true
require "yaml"
require "json"

root = File.expand_path("..", __dir__)
apps =
  Dir[File.join(root, "apps", "*", "app.yml")]
    .map { |path| File.basename(File.dirname(path)) }
    .sort

# Validate dependency declarations for every caller, including --list.
apps.each do |slug|
  config = YAML.safe_load(File.read(File.join(root, "apps", slug, "app.yml")))
  %w[uses paths].each do |field|
    values = config.fetch(field, [])
    unless values.is_a?(Array) &&
             values.all? { |v| v.is_a?(String) && !v.empty? }
      abort("#{slug}: #{field} must be a list of nonempty strings")
    end
  end
  config
    .fetch("uses", [])
    .each do |package|
      unless !%w[. ..].include?(package) && !package.include?("/") &&
               Dir.exist?(File.join(root, "packages", package))
        abort("#{slug}: unknown package '#{package}'")
      end
    end
  config
    .fetch("paths", [])
    .each do |pattern|
      if pattern.start_with?("/") || pattern.split("/").include?("..")
        abort("#{slug}: paths must be repo-relative globs")
      end
    end
end

if ARGV.first == "--list"
  key = ARGV[1]
  puts(
    apps.select do |app|
      key.nil? ||
        YAML.safe_load(File.read(File.join(root, "apps", app, "app.yml")))[key]
    end
  )
  exit
end

app, key = ARGV
unless app && key
  abort(
    "usage: app-config.rb <app> <key> | --list [key]\napps: #{apps.join(", ")}"
  )
end
unless apps.include?(app)
  abort("Unknown app '#{app}'. Apps: #{apps.join(", ")}")
end
config = YAML.safe_load(File.read(File.join(root, "apps", app, "app.yml")))
value =
  case key
  when "dir"
    "apps/#{app}"
  when "project_path"
    "apps/#{app}/#{config.fetch("project")}"
  else
    config[key]
  end
abort("#{app} has no '#{key}' in apps/#{app}/app.yml") if value.nil?
puts(value.is_a?(Array) || value.is_a?(Hash) ? value.to_json : value)
