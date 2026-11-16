# Reads projects/<app>/app.yml for shell scripts and workflows.
#   ruby scripts/app-config.rb tendr scheme        -> Still
#   ruby scripts/app-config.rb tendr project_path  -> projects/tendr/Still.xcodeproj
#   ruby scripts/app-config.rb --list              -> every app folder with an app.yml
#   ruby scripts/app-config.rb --list testflight   -> only apps whose app.yml sets testflight: true
require "yaml"
require "json"

root = File.expand_path("..", __dir__)
apps =
  Dir[File.join(root, "projects", "*", "app.yml")]
    .map { |path| File.basename(File.dirname(path)) }
    .sort

if ARGV.first == "--list"
  key = ARGV[1]
  puts(
    apps.select do |app|
      key.nil? ||
        YAML.safe_load(File.read(File.join(root, "projects", app, "app.yml")))[
          key
        ]
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
config = YAML.safe_load(File.read(File.join(root, "projects", app, "app.yml")))
value =
  case key
  when "dir"
    "projects/#{app}"
  when "project_path"
    "projects/#{app}/#{config.fetch("project")}"
  else
    config[key]
  end
abort("#{app} has no '#{key}' in projects/#{app}/app.yml") if value.nil?
puts(value.is_a?(Array) || value.is_a?(Hash) ? value.to_json : value)
