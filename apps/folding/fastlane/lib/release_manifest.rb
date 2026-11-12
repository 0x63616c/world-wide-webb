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
require_relative "check_evidence"

module FoldingRelease
  ROOT = File.expand_path("../..", __dir__)
  CONFIG = JSON.parse(File.read(File.join(ROOT, "fastlane/release-config.json")))
  STATES = %w[planned validated assets_ready archived uploaded processed ready_to_submit submitted approved live].freeze
  NULL_FIELDS = %w[archive_sha256 ipa_sha256 dsym_sha256 screenshot_manifest_sha256 metadata_manifest_sha256 tip_review_manifest_sha256 tip_review_map_sha256 deployed_worker_version asc_build_id asc_processing_state submission_id submission_state].freeze

  def self.run(*arguments)
    if arguments.first == "git" && ENV["GITHUB_ACTIONS"] == "true" && ENV["GH_TOKEN"] && !ENV["GH_TOKEN"].empty?
      # Authenticated lazy reads inherit this invocation's token, never a stored
      # checkout credential available to earlier dependency setup.
      arguments = ["git", "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", *arguments.drop(1)]
    end
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
    raise "Unknown environment" unless environment == "production"
    identity = FoldingAppleAccount.config.fetch(environment)
    {
      "environment" => environment, "identity" => identity, "apple_team_id" => CONFIG.fetch("apple_team_id"),
      "scheme" => CONFIG.fetch("scheme"), "configuration" => CONFIG.fetch("archive_configuration"),
      "project_sha256" => sha(File.join(ROOT, "apps/ios/project.yml")),
      "toolchain_sha256" => sha(File.join(ROOT, "tool-versions.json")),
      "api_origin" => "https://api.getfolding.app",
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

  def self.release_actor
    if ENV["GITHUB_ACTIONS"] == "true"
      value = ENV.fetch("GITHUB_ACTOR")
      raise "Missing trusted workflow actor" if value.strip.empty?
      value
    else
      JSON.parse(run("gh", "api", "user")).fetch("login")
    end
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
    attr_reader :tag, :repository
    def initialize(tag)
      raise "Invalid release tag" unless tag.match?(/\A(?:v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?|folding\/build-[1-9]\d*|folding\/backend-production|folding-build-reservations)\z/)
      @tag = tag
      @historical = tag.start_with?("v")
      @repository = CONFIG.fetch(@historical ? "historical_repository" : "repository")
    end

    def info
      output, error, status = Open3.capture3("gh", "release", "view", tag, "--repo", repository, "--json", "tagName,isDraft,assets", chdir: ROOT)
      unless status.success?
        return nil if error.include?("release not found")
        raise "Could not inspect GitHub release; do not assume it is absent"
      end
      JSON.parse(output)
    end

    def ensure_exists(commit)
      writable!
      return if info
      FoldingRelease.run("gh", "release", "create", tag, "--repo", repository, "--target", commit, "--draft", "--title", tag, "--notes", "Folding immutable release artifacts. Preparation is in progress.")
    end

    def latest(prefix)
      release = info
      return nil unless release
      name = release.fetch("assets").map { |asset| asset.fetch("name") }
        .grep(/\A#{Regexp.escape(prefix)}-r\d{8}\.json\z/).max
      return nil unless name
      Dir.mktmpdir("folding-release-read") do |directory|
        FoldingRelease.run("gh", "release", "download", tag, "--repo", repository, "--pattern", name, "--dir", directory)
        FoldingRelease.read_json(File.join(directory, name))
      end
    end

    def upload(path)
      writable!
      # No --clobber: a duplicate revision/artifact name is a failed compare-and-set, not an overwrite.
      FoldingRelease.run("gh", "release", "upload", tag, path, "--repo", repository)
    end

    def upload_artifact(path)
      writable!
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
      FoldingRelease.run("gh", "release", "download", tag, "--repo", repository, "--pattern", name, "--dir", directory)
    end

    def publish
      # Apple publishes the app. Release records and signed artifacts stay in
      # authenticated GitHub drafts, including when the source repo is public.
      raise "Artifact release is missing" unless writable!
    end

    private

    def writable!
      raise "Historical Folding artifacts are read-only; create a namespaced build record" if @historical
      release = info
      raise "Folding artifact storage must remain a private draft" if release && release["isDraft"] != true
      release
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

  def self.allocate_build(source:, version:, environment:, identity:, maximum:, requested_tag:, replacement_for: nil)
    store = GitHubArtifacts.new(CONFIG.fetch("reservation_tag"))
    begin
      store.ensure_exists(source)
    rescue StandardError
      # A concurrent first allocator may have created the ledger successfully.
      raise unless store.info
    end
    key = [source, version, configuration_hash(environment)].join(":")
    key += ":replacement:#{replacement_for}" if replacement_for
    5.times do
      ledger = store.latest("reservations") || {"schema_version" => 1, "revision" => 0, "reservations" => []}
      existing = ledger.fetch("reservations").find { |entry| entry.fetch("idempotency_key") == key }
      if existing
        raise "Reservation belongs to another release tag" if requested_tag && existing.fetch("tag") != requested_tag
        return existing
      end
      build = [maximum, ledger.fetch("reservations").map { |entry| entry.fetch("build_number") }.max || 0].max + 1
      raise "Build number exceeds the supported signed metadata range" unless build <= 2_147_483_647
      tag = "folding/build-#{build}"
      raise "New releases use the allocated build tag #{tag}" if requested_tag && requested_tag != tag
      reservation = {"idempotency_key" => key, "tag" => tag, "commit_sha" => source, "marketing_version" => version,
        "configuration_hash" => configuration_hash(environment), "bundle_id" => identity.fetch("bundle_id"),
        "build_number" => build, "created_at" => Time.now.utc.iso8601}
      ledger["reservations"] << reservation
      ledger["revision"] += 1
      begin
        Dir.mktmpdir("folding-reservation") do |directory|
          file = File.join(directory, format("reservations-r%08d.json", ledger.fetch("revision")))
          atomic_json(file, ledger)
          # GitHub rejects an existing asset name. This append-only CAS is shared
          # by beta/store and local/CI publishers alike.
          store.upload(file)
        end
        return reservation
      rescue StandardError
        # Re-read after a collision or ambiguous response; the same intent reuses
        # a successful reservation rather than allocating twice.
        next
      end
    end
    raise "Build allocation could not be confirmed; retry without changing the release intent"
  end

  def self.follow_replacement(tag)
    visited = []
    loop do
      raise "Cyclic release replacement history" if visited.include?(tag)
      visited << tag
      record = Record.new(tag)
      replacement = record.data["replacement_tag"]
      unless replacement
        record.verify_identity!
        return record
      end
      raise "Invalid release replacement history" unless record.data["cancelled"] && record.data.fetch("commit_sha") == commit
      tag = replacement
    end
  end

  def self.reserve(tag: nil, environment:, version:, replacement_for: nil)
    source = clean_commit!
    raise "Wrong Apple team override" if ENV["APPLE_TEAM_ID"] && ENV["APPLE_TEAM_ID"] != CONFIG.fetch("apple_team_id")
    raise "Invalid marketing version" unless version.match?(/\A\d+\.\d+\.\d+\z/)
    if tag
      prior = GitHubArtifacts.new(tag).latest("manifest")
      if prior
        record = follow_replacement(tag)
        raise "Version/environment changed" unless prior.fetch("marketing_version") == version && prior.fetch("environment") == environment
        return record
      end
    end
    ancestry = JSON.parse(run("gh", "api", "repos/#{CONFIG.fetch('repository')}/compare/#{source}...main"))
    raise "Release commit must be on trusted main history" unless %w[ahead identical].include?(ancestry["status"])
    config = configuration(environment)
    identity = config.fetch("identity")
    app = Spaceship::ConnectAPI::App.find(identity.fetch("bundle_id"), client: client)
    raise "Register the exact App Store app before reservation" unless app && app.id == identity.fetch("app_store_id")
    maximum = app.get_builds(client: client).map do |build|
      raise "Existing build number is not an integer" unless build.version.match?(/\A\d+\z/)
      build.version.to_i
    end.max || 0
    floor = minimum_supported_build(environment)
    reservation = allocate_build(source: source, version: version, environment: environment,
      identity: identity, maximum: [maximum, floor - 1].max, requested_tag: tag, replacement_for: replacement_for)
    tag = reservation.fetch("tag")
    remote = GitHubArtifacts.new(tag)
    existing = remote.latest("manifest")
    if existing
      return follow_replacement(tag)
    end
    remote.ensure_exists(source)
    locks = ["Gemfile.lock", "backend/Cargo.lock", "backend/bun.lock"] + Dir.glob(File.join(ROOT, "apps/ios/**/Package.resolved")).map { |file| file.delete_prefix(ROOT + "/") }
    manifest = NULL_FIELDS.to_h { |field| [field, nil] }.merge(
      "schema_version" => 1, "revision" => 1, "state" => "planned", "release_id" => SecureRandom.uuid,
      "tag" => tag, "environment" => environment, "commit_sha" => source, "marketing_version" => version,
      "build_number" => reservation.fetch("build_number"), "bundle_id" => identity.fetch("bundle_id"),
      "apple_team_id" => CONFIG.fetch("apple_team_id"), "asc_app_id" => app.id,
      "configuration_hash" => configuration_hash(environment), "archive_configuration" => config,
      "toolchain_versions" => read_json(File.join(ROOT, "tool-versions.json")),
      "backend_toolchain_versions" => read_json(File.join(ROOT, "backend/tool-versions.json")),
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

  def self.minimum_supported_build(environment)
    configuration(environment)
    origin = "https://api.getfolding.app"
    floor = fetch_json("#{origin}/v1/client-policy").fetch("minimum_ios_build")
    raise "Invalid live minimum build policy" unless floor.is_a?(Integer) && floor.between?(0, 2_147_483_647)
    floor
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
      raise "Required check is missing: #{name}" unless check
      raise "Duplicate check name: #{name}" unless checks.count { |item| item["name"] == name } == 1
      CheckEvidence.validate!(check, source: source, base: File.dirname(File.expand_path(path)))
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
    verified_backend!(record, backend)
    # The owner explicitly scheduled physical provider/device checks after App
    # Review submission. Preserve missing evidence; never promote runtime claims.
    deferred = CONFIG.fetch("post_submission_device_capabilities")
    record.save("post_submission_acceptance" => {"state" => "owner_deferred", "capabilities" => deferred,
      "reference" => "docs/review-spec.md#owner-approved-execution-update--november-7-2026"})
    CONFIG.fetch("public_urls").each do |url|
      uri = URI(url)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 30) { |http| http.get(uri.request_uri) }
      raise "Required public page unavailable: #{uri.path}" unless response.code == "200" && response.body.bytesize > 100
    end
    backend.fetch("worker_version")
  end

  def self.backend_input_hash(source)
    raise "Invalid backend source" unless source.match?(/\A[0-9a-f]{40}\z/)
    repository = run("git", "rev-parse", "--show-toplevel")
    prefix = run("git", "-C", repository, "ls-tree", "-r", "--name-only", source, "--", "apps/folding/backend/Cargo.toml").empty? ? "" : "apps/folding/"
    paths = %w[backend/Cargo.toml backend/Cargo.lock backend/rust-toolchain.toml backend/crates backend/migrations]
    entries = run("git", "-C", repository, "ls-tree", "-r", source, "--", *paths.map { |path| prefix + path }).lines.map do |line|
      metadata, path = line.chomp.split("\t", 2)
      [path.delete_prefix(prefix), metadata]
    end.reject { |path, _| path.end_with?(".md") || path.include?("/tests/") }
    raise "Backend input tree is incomplete" unless entries.any? { |path, _| path == "backend/Cargo.toml" }
    pin_file = run("git", "-C", repository, "ls-tree", "--name-only", source, "--", "#{prefix}backend/tool-versions.json").empty? ? "tool-versions.json" : "backend/tool-versions.json"
    pins = JSON.parse(run("git", "show", "#{source}:#{prefix}#{pin_file}"))
    Digest::SHA256.hexdigest(JSON.generate({"files" => entries.sort, "rust" => pins.fetch("rust"), "worker_build" => pins.fetch("worker_build", "0.8.7")}))
  end

  def self.verified_backend!(record, backend)
    worker_source = backend.fetch("worker_version")
    input_hash = backend_input_hash(record.data.fetch("commit_sha"))
    raise "Deployed backend inputs differ from this candidate" unless backend_input_hash(worker_source) == input_hash
    path = ENV.fetch("FOLDING_BACKEND_DEPLOYMENT_RECEIPT") { raise "Supply the immutable verified backend deployment receipt" }
    receipt = read_json(path)
    raise "Wrong backend deployment receipt" unless receipt["schema_version"] == 1 && receipt["environment"] == record.data.fetch("environment") &&
      receipt["worker_source_sha"] == worker_source && receipt["backend_input_hash"] == input_hash &&
      receipt["cloudflare_version_id"].to_s.match?(/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/)
    check = receipt.fetch("backend_check")
    raise "Deployment receipt requires the backend CI check" unless check["name"] == "backend" && check["kind"] == "ci"
    CheckEvidence.validate!(check, source: worker_source, base: File.dirname(File.expand_path(path)))
    account = receipt.fetch("account_id")
    script = receipt.fetch("worker_script")
    raise "Wrong Cloudflare deployment owner" unless account.match?(/\A[0-9a-f]{32}\z/) && script == "folding-api-#{record.data.fetch('environment')}"
    provider = fetch_json("https://api.cloudflare.com/client/v4/accounts/#{account}/workers/scripts/#{script}/deployments",
      {"Authorization" => "Bearer #{ENV.fetch('FOLDING_RELEASE_POLICY_TOKEN')}"})
    versions = provider.dig("result", "deployments", 0, "versions")
    raise "The verified Worker version is not the current complete deployment" unless provider["success"] == true && versions.is_a?(Array) && versions.length == 1 &&
      versions.first["version_id"] == receipt.fetch("cloudflare_version_id") && versions.first["percentage"] == 100
    uploaded = fetch_json("https://api.cloudflare.com/client/v4/accounts/#{account}/workers/scripts/#{script}/versions/#{receipt.fetch('cloudflare_version_id')}",
      {"Authorization" => "Bearer #{ENV.fetch('FOLDING_RELEASE_POLICY_TOKEN')}"})
    bindings = uploaded.dig("result", "resources", "bindings")
    raise "Cannot confirm the deployed Worker bindings" unless uploaded["success"] == true && uploaded.dig("result", "id") == receipt.fetch("cloudflare_version_id") && bindings.is_a?(Array)
    runtime = receipt.fetch("runtime_configuration")
    expected_app = "#{record.data.fetch('apple_team_id')}.#{record.data.fetch('bundle_id')}"
    expected_vars = {"WORKER_VERSION" => worker_source, "DEPLOYMENT" => record.data.fetch("environment"), "APP_ATTEST_APP_ID" => expected_app}
    raise "Deployment configuration belongs to another app/account" unless runtime.fetch("account_id") == account &&
      expected_vars.all? { |name, value| runtime.fetch("vars")[name] == value }
    expected_vars.each do |name, value|
      matching = bindings.select { |binding| binding["name"] == name }
      raise "Deployed Worker configuration differs from its receipt" unless matching.length == 1 && matching.first["type"] == "plain_text" && matching.first["text"] == value
    end
    databases = runtime.fetch("d1_databases")
    database = bindings.select { |binding| binding["name"] == "DB" }
    raise "Release policy database is not bound to the deployed Worker" unless databases.length == 1 && databases.first["binding"] == "DB" &&
      database.length == 1 && database.first["type"] == "d1" && database.first["id"] == databases.first["database_id"] &&
      databases.first["database_id"].to_s.match?(/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/)
    record.save("backend_deployment_receipt_sha256" => sha(path), "backend_input_hash" => input_hash)
    worker_source
  end

  # Internal TestFlight retains the broader shipping deferrals. The exact deployed
  # backend must have verified matching inputs, independent of unrelated app commits.
  def self.preview_prerequisites!(record)
    origin = record.data.fetch("archive_configuration").fetch("api_origin")
    backend = fetch_json("#{origin}/v1/capabilities")
    raise "Backend contract mismatch" unless backend["contract_version"] == CONFIG.fetch("backend_contract_version")
    missing = CONFIG.fetch("preview_backend_capabilities") - backend.fetch("capabilities")
    raise "Preview feature capabilities missing: #{missing.join(',')}" unless missing.empty?
    verified_backend!(record, backend)
    record.save("preview_backend_verification" => {
      "worker_version" => backend.fetch("worker_version"),
      "capabilities" => CONFIG.fetch("preview_backend_capabilities"),
      "verified_at" => Time.now.utc.iso8601
    })
    backend.fetch("worker_version")
  end
end
