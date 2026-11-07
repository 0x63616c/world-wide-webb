require "digest"
require "fileutils"
require "json"
require "net/http"
require "open3"
require "securerandom"
require "time"
require "tmpdir"
require "uri"
require_relative "apple_account"

module FoldingRelease
  ROOT = File.expand_path("../..", __dir__)
  CONFIG = JSON.parse(File.read(File.join(ROOT, "fastlane/release-config.json")))
  STATES = %w[planned validated assets_ready archived uploaded processed ready_to_submit submitted approved live].freeze
  NULL_FIELDS = %w[archive_sha256 ipa_sha256 dsym_sha256 screenshot_manifest_sha256 metadata_manifest_sha256 deployed_worker_version asc_build_id asc_processing_state submission_id submission_state].freeze

  def self.run(*arguments)
    output, _error, status = Open3.capture3(*arguments, chdir: ROOT)
    raise "Command failed: #{File.basename(arguments.first)} (exit #{status.exitstatus})" unless status.success?
    output.strip
  end

  def self.read_json(path)
    JSON.parse(File.read(path))
  end

  def self.sha(path)
    Digest::SHA256.file(path).hexdigest
  end

  def self.atomic_json(path, value)
    FileUtils.mkdir_p(File.dirname(path))
    temporary = "#{path}.#{SecureRandom.hex(8)}.tmp"
    File.open(temporary, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
      file.write(JSON.pretty_generate(value) + "\n")
      file.flush
      file.fsync
    end
    File.rename(temporary, path)
  ensure
    File.delete(temporary) if temporary && File.exist?(temporary)
  end

  def self.commit
    value = run("git", "rev-parse", "HEAD")
    raise "Expected full commit SHA" unless value.match?(/\A[0-9a-f]{40}\z/)
    value
  end

  def self.clean_commit!
    raise "Commit source changes before creating release assets" unless run("git", "status", "--porcelain").empty?
    commit
  end

  def self.configuration(environment)
    raise "Unknown environment" unless %w[production staging].include?(environment)
    identity = FoldingAppleAccount.config.fetch(environment)
    {
      "environment" => environment, "identity" => identity, "apple_team_id" => CONFIG.fetch("apple_team_id"),
      "scheme" => CONFIG.fetch("scheme"), "configuration" => CONFIG.fetch("archive_configuration"),
      "project_sha256" => sha(File.join(ROOT, "apps/ios/project.yml")),
      "toolchain_sha256" => sha(File.join(ROOT, "tool-versions.json")),
      "api_origin" => environment == "production" ? "https://api.getfolding.app" : "https://api-staging.getfolding.app",
      "distribution_entitlements" => {"icloud" => "Production", "app_attest" => "production", "apns" => "production"}
    }
  end

  def self.configuration_hash(environment)
    Digest::SHA256.hexdigest(JSON.generate(configuration(environment)))
  end

  def self.api_key
    # Fastlane treats key_content as sensitive. Never pass this hash into any manifest/log.
    {key_id: ENV.fetch("ASC_KEY_ID"), issuer_id: ENV.fetch("ASC_ISSUER_ID"),
      key: ENV.fetch("ASC_PRIVATE_KEY"), duration: 600, in_house: false}
  end

  def self.client
    @client ||= FoldingAppleAccount.client
  end

  def self.app(manifest)
    value = Spaceship::ConnectAPI::App.find(manifest.fetch("bundle_id"), client: client)
    raise "App Store identity changed" unless value && value.id == manifest.fetch("asc_app_id")
    value
  end

  def self.exact_build(manifest)
    matches = app(manifest).get_builds(client: client,
      filter: {version: manifest.fetch("build_number").to_s}, includes: "preReleaseVersion")
      .select { |build| build.app_version == manifest.fetch("marketing_version") }
    raise "Ambiguous App Store build" if matches.length > 1
    matches.first
  end

  class GitHubArtifacts
    attr_reader :tag
    def initialize(tag)
      raise "Invalid release tag" unless tag.match?(/\A(?:v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?|folding-build-reservations)\z/)
      @tag = tag
    end

    def info
      output, error, status = Open3.capture3("gh", "release", "view", tag, "--repo", CONFIG.fetch("repository"), "--json", "tagName,isDraft,assets", chdir: ROOT)
      unless status.success?
        return nil if error.include?("release not found")
        raise "Could not inspect GitHub release; do not assume it is absent"
      end
      JSON.parse(output)
    end

    def ensure_exists(commit)
      return if info
      FoldingRelease.run("gh", "release", "create", tag, "--repo", CONFIG.fetch("repository"), "--target", commit, "--draft", "--title", tag, "--notes", "Folding immutable release artifacts. Preparation is in progress.")
    end

    def latest(prefix)
      release = info
      return nil unless release
      name = release.fetch("assets").map { |asset| asset.fetch("name") }
        .grep(/\A#{Regexp.escape(prefix)}-r\d{8}\.json\z/).max
      return nil unless name
      Dir.mktmpdir("folding-release-read") do |directory|
        FoldingRelease.run("gh", "release", "download", tag, "--repo", CONFIG.fetch("repository"), "--pattern", name, "--dir", directory)
        FoldingRelease.read_json(File.join(directory, name))
      end
    end

    def upload(path)
      # No --clobber: a duplicate revision/artifact name is a failed compare-and-set, not an overwrite.
      FoldingRelease.run("gh", "release", "upload", tag, path, "--repo", CONFIG.fetch("repository"))
    end

    def upload_artifact(path)
      existing = info&.fetch("assets")&.any? { |asset| asset.fetch("name") == File.basename(path) }
      if existing
        Dir.mktmpdir("folding-artifact-compare") do |directory|
          download(File.basename(path), directory)
          raise "Immutable remote artifact differs" unless FoldingRelease.sha(path) == FoldingRelease.sha(File.join(directory, File.basename(path)))
        end
      else
        upload(path)
      end
    end

    def download(name, directory)
      raise "Invalid artifact name" unless File.basename(name) == name
      FoldingRelease.run("gh", "release", "download", tag, "--repo", CONFIG.fetch("repository"), "--pattern", name, "--dir", directory)
    end

    def publish
      FoldingRelease.run("gh", "release", "edit", tag, "--repo", CONFIG.fetch("repository"), "--draft=false")
    end
  end

  class Record
    attr_reader :data, :directory, :remote
    def initialize(tag)
      @remote = GitHubArtifacts.new(tag)
      @directory = File.join(ROOT, "build/releases", tag)
      @data = remote.latest("manifest")
      raise "Release record does not exist; run reserve first" unless @data
      FileUtils.mkdir_p(directory)
      FoldingRelease.atomic_json(path, data)
    end

    def path
      File.join(directory, "release.json")
    end

    def save(changes)
      candidate = data.merge(changes).merge("revision" => data.fetch("revision") + 1, "updated_at" => Time.now.utc.iso8601)
      name = format("manifest-r%08d.json", candidate.fetch("revision"))
      file = File.join(directory, name)
      if File.exist?(file)
        existing = FoldingRelease.read_json(file)
        raise "Unreconciled manifest revision exists; inspect remote and retry from latest record" unless existing == candidate
      end
      FoldingRelease.atomic_json(file, candidate)
      remote.upload(file)
      @data = candidate
      FoldingRelease.atomic_json(path, candidate)
      candidate
    end

    def advance(state, changes = {})
      raise "Unknown release state" unless STATES.include?(state)
      old = STATES.index(data.fetch("state"))
      target = STATES.index(state)
      raise "Release state regression" if target < old
      save(changes.merge("state" => state))
    end

    def artifact(kind)
      name = data.fetch("artifacts").fetch(kind)
      path = File.join(directory, name)
      remote.download(name, directory) unless File.exist?(path)
      expected = data.fetch("#{kind}_sha256")
      raise "Artifact content changed: #{kind}" unless expected && FoldingRelease.sha(path) == expected
      path
    end

    def verify_identity!
      raise "Wrong source commit" unless data.fetch("commit_sha") == FoldingRelease.commit
      raise "Archive configuration changed" unless data.fetch("configuration_hash") == FoldingRelease.configuration_hash(data.fetch("environment"))
      raise "Cancelled release" if data["cancelled"]
    end
  end

  def self.reserve(tag:, environment:, version:)
    source = clean_commit!
    raise "Wrong Apple team override" if ENV["APPLE_TEAM_ID"] && ENV["APPLE_TEAM_ID"] != CONFIG.fetch("apple_team_id")
    raise "Invalid marketing version" unless version.match?(/\A\d+\.\d+\.\d+\z/)
    raise "Production tag must match marketing version" if environment == "production" && tag != "v#{version}"
    visibility = JSON.parse(run("gh", "repo", "view", CONFIG.fetch("repository"), "--json", "visibility")).fetch("visibility")
    raise "Distribution artifacts require a private repository" unless visibility == "PRIVATE"
    remote = GitHubArtifacts.new(tag)
    existing = remote.latest("manifest")
    if existing
      record = Record.new(tag)
      record.verify_identity!
      raise "Version/environment changed" unless existing.fetch("marketing_version") == version && existing.fetch("environment") == environment
      return record
    end
    ancestry = JSON.parse(run("gh", "api", "repos/#{CONFIG.fetch('repository')}/compare/#{source}...main"))
    raise "Release commit must be on trusted main history" unless %w[ahead identical].include?(ancestry["status"])
    config = configuration(environment)
    identity = config.fetch("identity")
    app = Spaceship::ConnectAPI::App.find(identity.fetch("bundle_id"), client: client)
    raise "Register the exact App Store app before reservation" unless app && app.id == identity.fetch("app_store_id")
    maximum = %w[production staging].flat_map do |name|
      identifier = FoldingAppleAccount.config.fetch(name)
      registered = Spaceship::ConnectAPI::App.find(identifier.fetch("bundle_id"), client: client)
      raise "Both App Store registrations are required" unless registered && registered.id == identifier.fetch("app_store_id")
      registered.get_builds(client: client, includes: "preReleaseVersion").map do |build|
        raise "Existing build number is not an integer" unless build.version.match?(/\A\d+\z/)
        build.version.to_i
      end
    end.max || 0
    ledger_store = GitHubArtifacts.new(CONFIG.fetch("reservation_tag"))
    ledger_store.ensure_exists(source)
    ledger = ledger_store.latest("reservations") || {"schema_version" => 1, "revision" => 0, "reservations" => []}
    key = [source, version, configuration_hash(environment)].join(":")
    reservation = ledger.fetch("reservations").find { |entry| entry.fetch("idempotency_key") == key }
    raise "Reservation already belongs to another release tag" if reservation && reservation["tag"] != tag
    unless reservation
      maximum = [maximum, ledger.fetch("reservations").map { |entry| entry.fetch("build_number") }.max || 0].max
      reservation = {"idempotency_key" => key, "tag" => tag, "commit_sha" => source, "marketing_version" => version,
        "configuration_hash" => configuration_hash(environment), "bundle_id" => identity.fetch("bundle_id"),
        "build_number" => maximum + 1, "created_at" => Time.now.utc.iso8601}
      ledger["reservations"] << reservation
      ledger["revision"] += 1
      Dir.mktmpdir("folding-reservation") do |directory|
        file = File.join(directory, format("reservations-r%08d.json", ledger.fetch("revision")))
        atomic_json(file, ledger)
        ledger_store.upload(file)
      end
    end
    remote.ensure_exists(source)
    locks = ["Gemfile.lock", "backend/Cargo.lock", "backend/package-lock.json"] + Dir.glob(File.join(ROOT, "apps/ios/**/Package.resolved")).map { |file| file.delete_prefix(ROOT + "/") }
    manifest = NULL_FIELDS.to_h { |field| [field, nil] }.merge(
      "schema_version" => 1, "revision" => 1, "state" => "planned", "release_id" => SecureRandom.uuid,
      "tag" => tag, "environment" => environment, "commit_sha" => source, "marketing_version" => version,
      "build_number" => reservation.fetch("build_number"), "bundle_id" => identity.fetch("bundle_id"),
      "apple_team_id" => CONFIG.fetch("apple_team_id"), "asc_app_id" => app.id,
      "configuration_hash" => configuration_hash(environment), "archive_configuration" => config,
      "toolchain_versions" => read_json(File.join(ROOT, "tool-versions.json")),
      "dependency_lock_hashes" => locks.to_h { |path| [path, sha(File.join(ROOT, path))] },
      "fixture_version" => CONFIG.fetch("fixture_version"), "backend_contract_version" => CONFIG.fetch("backend_contract_version"),
      "minimum_backend_capabilities" => CONFIG.fetch("minimum_backend_capabilities"),
      "required_checks" => [], "automatic_release" => environment == "production",
      "created_at" => Time.now.utc.iso8601, "updated_at" => Time.now.utc.iso8601,
      "workflow_run_url" => ENV.fetch("FOLDING_WORKFLOW_RUN_URL"), "artifacts" => {},
      "device_checks" => {"state" => "deferred", "milestone" => "F13", "owner_authorized" => true})
    directory = File.join(ROOT, "build/releases", tag)
    file = File.join(directory, "manifest-r00000001.json")
    atomic_json(file, manifest)
    remote.upload(file)
    Record.new(tag)
  end

  def self.fetch_json(url, headers = {})
    uri = URI(url)
    raise "HTTPS required" unless uri.scheme == "https"
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 30) do |http|
      request = Net::HTTP::Get.new(uri.request_uri)
      headers.each { |name, value| request[name] = value }
      http.request(request)
    end
    raise "HTTP prerequisite failed (#{response.code})" unless response.is_a?(Net::HTTPSuccess)
    JSON.parse(response.body)
  end

  def self.check_evidence!(record, path, final: false)
    evidence = read_json(path)
    source = record.data.fetch("commit_sha")
    raise "Check evidence is for another commit" unless evidence.fetch("commit_sha") == source
    checks = evidence.fetch("required_checks")
    required = CONFIG.fetch("required_checks")
    required -= %w[screenshots final-review] unless final
    required.each do |name|
      check = checks.find { |item| item["name"] == name }
      raise "Required check is missing or failed: #{name}" unless check && check["conclusion"] == "success" && check["commit_sha"] == source && check["run_url"].to_s.start_with?("https://github.com/#{CONFIG.fetch('repository')}/")
      match = check.fetch("run_url").match(%r{\Ahttps://github\.com/#{Regexp.escape(CONFIG.fetch("repository"))}/actions/runs/(\d+)(?:[/?#].*)?\z})
      raise "Required evidence must reference a GitHub Actions run" unless match
      run_record = JSON.parse(run("gh", "api", "repos/#{CONFIG.fetch('repository')}/actions/runs/#{match[1]}"))
      raise "GitHub check is not a successful run for this commit" unless run_record["head_sha"] == source && run_record["status"] == "completed" && run_record["conclusion"] == "success"
    end
    raise "Apple account prerequisites not recorded" unless evidence["account_prerequisites_confirmed"] == true
    if final
      review = evidence.fetch("final_review")
      raise "Final review must finish before submission" unless review["state"] == "approved" && review["commit_sha"] == source && !review["evidence_url"].to_s.empty?
    end
    evidence
  end

  def self.live_prerequisites!(record)
    origin = record.data.fetch("archive_configuration").fetch("api_origin")
    backend = fetch_json("#{origin}/v1/capabilities")
    raise "Backend contract mismatch" unless backend["contract_version"] == CONFIG.fetch("backend_contract_version")
    missing = CONFIG.fetch("minimum_backend_capabilities") - backend.fetch("capabilities")
    raise "Required backend capabilities missing: #{missing.join(',')}" unless missing.empty?
    raise "Missing deployed Worker identity" if backend["worker_version"].to_s.empty?
    CONFIG.fetch("public_urls").each do |url|
      uri = URI(url)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 30) { |http| http.get(uri.request_uri) }
      raise "Required public page unavailable: #{uri.path}" unless response.code == "200" && response.body.bytesize > 100
    end
    backend.fetch("worker_version")
  end
end
