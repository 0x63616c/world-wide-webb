# Exercise the real lane with recorded actions: no Apple access or signing changes.
ENV["ASC_BETA_FEEDBACK_EMAIL"] = "ci@example.invalid"
ENV["ASC_KEY_ID"] = "test-key"
ENV["ASC_ISSUER_ID"] = "test-issuer"
ENV["ASC_KEY_CONTENT"] = "test-only"
ENV.delete("ASC_KEY_PATH")
ENV["RUNNER_TEMP"] = File.expand_path("../build", __dir__)

module UI
  def self.important(message); end
  def self.success(message); end

  def self.user_error!(message)
    raise message
  end
end

module Spaceship
  class ConnectAPI
    module Platform
      IOS = "IOS"
    end
    def self.client
      @client
    end
    def self.client=(value)
      @client = value
    end
  end
end

class ReleaseCheck
  attr_reader :calls
  attr_accessor :fail_tests

  def initialize
    @calls = []
    fastfile = File.expand_path("../fastlane/Fastfile", __dir__)
    instance_eval(File.read(fastfile), fastfile)
    # This harness records actions; loading installed deliver is outside its scope.
    define_singleton_method(:guard_first_review_detail) {}
  end

  def default_platform(*); end
  def desc(*); end
  def platform(*)
    yield
  end
  def lane(name, &block)
    define_singleton_method(name, &block)
  end
  alias private_lane lane

  def sh(*args)
    @calls << [:sh, args]
    raise "test failure" if fail_tests
  end

  def app_store_connect_api_key(**args)
    args
  end

  def latest_testflight_build_number(**args)
    @calls << [:latest, args]
    17
  end

  def build_app(**args)
    @calls << [:build, args]
  end


  def update_code_signing_settings(**args)
    @calls << [:signing, args]
    File.write(File.join(args[:path], "project.pbxproj"), "temporary signing settings")
  end

  def upload_to_testflight(**args)
    @calls << [:upload, args]
  end

  def deliver(**args)
    @calls << [:deliver, args]
  end
end

check = ReleaseCheck.new
ENV.delete("R_PROFILE_UUID")
ENV.delete("GITHUB_ACTIONS")
check.beta({ app: "tendr" })
raise "release order" unless check.calls.map(&:first) == [:sh, :latest, :build, :upload]
build = check.calls.assoc(:build).last
raise "local signing changed" unless build[:export_xcargs] == "-allowProvisioningUpdates" && build[:export_options].empty?
raise "next build number" unless build[:xcargs].include?("CURRENT_PROJECT_VERSION=18")
upload = check.calls.assoc(:upload).last
raise "distribution" unless upload[:groups] == ["Owner Preview"] && upload[:skip_waiting_for_build_processing] == false && upload[:build_number] == "18"

check.calls.clear
ENV["GITHUB_ACTIONS"] = "true"
begin
  check.beta({ app: "tendr" })
  raise "ignored missing Match profile"
rescue RuntimeError => error
  raise unless error.message == "CI requires an installed read-only Match profile"
end
raise "uploaded without signing" if check.calls.assoc(:upload)

check.calls.clear
profile_uuid = "12345678-1234-1234-1234-123456789ABC"
ENV["R_PROFILE_UUID"] = profile_uuid
check.beta({ app: "tendr" })
raise "release order" unless check.calls.map(&:first) == [:sh, :latest, :build, :upload]
build = check.calls.assoc(:build).last
raise "CI archive signing" unless build[:xcargs].include?("CODE_SIGN_STYLE=Manual") && build[:xcargs].include?("PROVISIONING_PROFILE_SPECIFIER=#{profile_uuid}")
raise "CI export signing" unless build[:export_options][:provisioningProfiles] == { "com.calumwebb.still" => profile_uuid } && build[:export_xcargs].empty?

check.calls.clear
check.fail_tests = true
begin
  check.beta({ app: "tendr" })
  raise "ignored failing tests"
rescue RuntimeError => error
  raise unless error.message == "test failure"
end
raise "released after failing tests" unless check.calls.map(&:first) == [:sh]

check.calls.clear
ENV.delete("APP")
begin
  check.beta({})
  raise "beta ran without an app"
rescue RuntimeError => error
  raise unless error.message.start_with?("Pass app:")
end
raise "built without an app" unless check.calls.empty?

check.calls.clear
ENV["ASC_REVIEW_PHONE"] = "+1 555 0100"
check.metadata({ app: "tendr" })
listing = check.calls.assoc(:deliver).last
raise "metadata lane must never submit or upload a binary" unless listing[:submit_for_review] == false && listing[:skip_binary_upload] == true && !listing.key?(:ipa)
raise "Tendr must release automatically after approval" unless listing[:automatic_release] == true
raise "metadata lane must run unattended" unless listing[:force] && listing[:run_precheck_before_submit] == false
tendr = File.expand_path("../apps/tendr", __dir__)
raise "metadata paths" unless listing[:metadata_path] == "#{tendr}/fastlane/metadata" && listing[:screenshots_path] == "#{tendr}/fastlane/screenshots" && listing[:overwrite_screenshots]
tendr_version = YAML.safe_load_file(File.join(tendr, "app.yml")).fetch("version")
raise "metadata app" unless listing[:app_identifier] == "com.calumwebb.still" && listing[:app_version] == tendr_version
raise "review phone from environment" unless listing[:app_review_information] == { phone_number: "+1 555 0100" }
check.calls.clear
check.metadata({ app: "tendr", skip_screenshots: "true" })
raise "skip_screenshots option" unless check.calls.assoc(:deliver).last[:skip_screenshots]

# A newer build must never replace the explicit selection, including preparation.
require "ostruct"
api = Object.new
api.define_singleton_method(:tunes_request_client) { self }
api.define_singleton_method(:get) do |_path, params = nil|
  raise "build query is not pinned" unless params.fetch("filter[version]") == "18" && params.fetch("filter[preReleaseVersion.version]") == tendr_version
  OpenStruct.new(body: { "data" => [
    { "id" => "build-19", "attributes" => { "version" => "19", "processingState" => "VALID", "expired" => false } },
    { "id" => "build-18", "attributes" => { "version" => "18", "processingState" => "VALID", "expired" => false } }
  ] })
end
Spaceship::ConnectAPI.client = api
selected = nil
store_version = OpenStruct.new(version_string: tendr_version, app_store_state: "PREPARE_FOR_SUBMISSION", build: nil)
store_version.define_singleton_method(:select_build) { |build_id:| selected = build_id }
app_record = OpenStruct.new(id: "app-id")
app_record.define_singleton_method(:get_edit_app_store_version) { |platform:| store_version }
check.define_singleton_method(:app_store_app) { |_config| app_record }
check.select_build(app: "tendr", build: "18")
raise "selected newest instead of pinned build" unless selected == "build-18"
%i[select_build prepare_review].each do |lane|
  check.calls.clear
  begin
    check.public_send(lane, app: "tendr")
    raise "missing build accepted"
  rescue ArgumentError => error
    raise unless error.message.include?("explicit build number")
  end
  raise "mutated without build" unless check.calls.empty?
end
store_version.app_store_state = "WAITING_FOR_REVIEW"
check.calls.clear
begin
  check.prepare_review(app: "tendr", build: "18")
  raise "prepared a waiting submission"
rescue RuntimeError => error
  raise unless error.message.include?("leave the current submission untouched")
end
raise "uploaded metadata while waiting" unless check.calls.empty?

store_version.app_store_state = "PREPARE_FOR_SUBMISSION"
%i[ensure_free_pricing age_rating review_detail_check review_status].each do |lane|
  check.define_singleton_method(lane) { |**_options| }
end
selected = nil
check.calls.clear
check.prepare_review(app: "tendr", build: "18", skip_screenshots: true)
raise "prepare_review lost pinned build" unless selected == "build-18"
raise "prepare_review lost screenshot skip" unless check.calls.assoc(:deliver).last[:skip_screenshots]

[[], [{ "id" => "expired", "attributes" => { "version" => "18", "processingState" => "VALID", "expired" => true } }],
 [{ "id" => "pending", "attributes" => { "version" => "18", "processingState" => "PROCESSING", "expired" => false } }]].each do |builds|
  api.define_singleton_method(:get) { |*_args| OpenStruct.new(body: { "data" => builds }) }
  check.calls.clear
  begin
    check.prepare_review(app: "tendr", build: "18")
    raise "unavailable build accepted"
  rescue ArgumentError => error
    raise unless error.message.include?("Expected one processed")
  end
  raise "metadata uploaded before build validation" unless check.calls.empty?
end

Spaceship::ConnectAPI.client = nil
check.fail_tests = false
ENV["GITHUB_ACTIONS"] = "true"
ENV.delete("R_PROFILE_UUID")


Dir[File.expand_path("../apps/tendr/fastlane/metadata", __dir__)].sort.each do |metadata|
  limits = { "name" => 30, "subtitle" => 30, "keywords" => 100, "promotional_text" => 170, "description" => 4000, "release_notes" => 4000 }
  limits.each do |field, limit|
    text = File.read(File.join(metadata, "en-US", "#{field}.txt"))
    raise "#{metadata}: #{field} is empty" if text.strip.empty?
    raise "#{field} is #{text.length} characters; the App Store limit is #{limit}" if text.length > limit
  end
  %w[privacy_url support_url marketing_url].each do |field|
    raise "#{field} must be https" unless File.read(File.join(metadata, "en-US", "#{field}.txt")).strip.match?(%r{\Ahttps://\S+\z})
  end
  raise "keywords must be comma separated without spaces" if File.read(File.join(metadata, "en-US", "keywords.txt")).match?(/,\s/)
  listing_text = Dir[File.join(metadata, "**", "*.txt")].map { |path| File.read(path) }.join("\n")
  banned = /semaglutide|tirzepatide|ozempic|wegovy|mounjaro|zepbound|saxenda|liraglutide|syringe|\bcures?\b|guarantee/i
  raise "listing mentions #{listing_text[banned]}; keep drug names and medical claims out of the listing" if listing_text.match?(banned)
end
puts "Release checks passed (app selection, local signing, CI signing, next build, distribution, failure gates, App Store listings)."

# Submission paths use the same policy even when deliver skips metadata.
policy_writes = []
policy_api = Object.new
policy_api.define_singleton_method(:patch) { |path, body| policy_writes << [path, body] }
ReleasePolicy.apply!(policy_api, { "bundle_id" => "com.calumwebb.still" }, "next-version")
raise "automatic release policy" unless policy_writes == [["v1/appStoreVersions/next-version", { data: { type: "appStoreVersions", id: "next-version", attributes: { releaseType: "AFTER_APPROVAL" } } }]]
ReleasePolicy.apply!(policy_api, { "bundle_id" => "com.example.other" }, "other-version")
raise "changed another app's release policy" unless policy_writes.length == 1 && ReleasePolicy.automatic?({ "bundle_id" => "com.example.other" }).nil?
puts "Release policy checks passed (Tendr automatic, other apps unchanged)."

# Shared source verification stays outside the Mac publisher pool.
require "yaml"
release_jobs = YAML.safe_load_file(File.expand_path("../.github/workflows/testflight.yml", __dir__), aliases: true).fetch("jobs")
gate = release_jobs.fetch("verify")
raise "source verification must run outside the Mac pool" unless gate.fetch("runs-on") == "ubuntu-24.04-arm"
%w[tendr folding].each do |app|
  raise "publisher must depend on source verification" unless release_jobs.fetch(app).fetch("needs") == "verify"
end
