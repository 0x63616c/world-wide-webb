require "minitest/autorun"
require_relative "../lib/release_manifest"

class BuildReservationsTest < Minitest::Test
  class Store
    attr_accessor :collide_once
    attr_reader :assets
    def initialize
      @assets = {}
    end
    def info
      { "assets" => assets.keys }
    end
    def ensure_exists(_source)
    end
    def latest(prefix)
      key = assets.keys.grep(/\A#{prefix}-r\d+\.json\z/).max
      key && JSON.parse(JSON.generate(assets.fetch(key)))
    end
    def upload(path)
      name = File.basename(path)
      value = JSON.parse(File.read(path))
      if collide_once
        self.collide_once = false
        other = JSON.parse(JSON.generate(value))
        other
          .fetch("reservations")
          .last
          .merge!(
            "idempotency_key" => "competing-intent",
            "commit_sha" => "c" * 40
          )
        assets[name] = other
        raise "Concurrent allocator won the asset CAS"
      end
      raise "Immutable revision already exists" if assets.key?(name)
      assets[name] = value
    end
  end
  App =
    Struct.new(:id) do
      def get_builds(**_options)
        [Struct.new(:version).new("42")]
      end
    end

  def setup
    @original_root = FoldingRelease::ROOT
    @temporary = Dir.mktmpdir("folding-build-reservations-test")
    FoldingRelease.send(:remove_const, :ROOT)
    FoldingRelease.const_set(:ROOT, @temporary)
    %w[
      Gemfile.lock
      backend/Cargo.lock
      backend/bun.lock
      tool-versions.json
      backend/tool-versions.json
      apps/ios/project.yml
    ].each do |name|
      file = File.join(@temporary, name)
      FileUtils.mkdir_p(File.dirname(file))
      FileUtils.cp(File.join(@original_root, name), file)
    end
    @previous_url = ENV["FOLDING_WORKFLOW_RUN_URL"]
    ENV[
      "FOLDING_WORKFLOW_RUN_URL"
    ] = "https://github.com/0x63616c/world-wide-webb/actions/runs/1"
    @source = "a" * 40
    @stores = Hash.new { |hash, tag| hash[tag] = Store.new }
  end

  def teardown
    ENV["FOLDING_WORKFLOW_RUN_URL"] = @previous_url
    FoldingRelease.send(:remove_const, :ROOT)
    FoldingRelease.const_set(:ROOT, @original_root)
    FileUtils.remove_entry(@temporary)
  end

  def reserve(
    environment = "production",
    tag: nil,
    replacement_for: nil,
    floor: 0
  )
    commands =
      lambda do |*args|
        case args[0, 3]
        when %w[gh repo view]
          '{"visibility":"PRIVATE"}'
        when [
               "gh",
               "api",
               "repos/0x63616c/world-wide-webb/compare/#{@source}...main"
             ]
          '{"status":"identical"}'
        else
          raise "Unexpected external operation: #{args[0, 2]}"
        end
      end
    find =
      lambda do |identifier, **_options|
        identity =
          FoldingAppleAccount.config.values.find do |item|
            item.is_a?(Hash) && item["bundle_id"] == identifier
          end
        App.new(identity.fetch("app_store_id"))
      end
    FoldingRelease.stub(:minimum_supported_build, floor) do
      FoldingRelease.stub(:clean_commit!, -> { @source }) do
        FoldingRelease.stub(:commit, -> { @source }) do
          FoldingRelease.stub(:client, :test_client) do
            FoldingRelease.stub(:run, commands) do
              Spaceship::ConnectAPI::App.stub(:find, find) do
                FoldingRelease::GitHubArtifacts.stub(
                  :new,
                  ->(name) { @stores[name] }
                ) do
                  FoldingRelease.reserve(
                    version: "1.0.0",
                    environment: environment,
                    tag: tag,
                    replacement_for: replacement_for
                  )
                end
              end
            end
          end
        end
      end
    end
  end

  def test_live_minimum_build_seeds_the_allocator_without_retiring_the_new_beta
    assert_equal 100, reserve(floor: 100).data.fetch("build_number")
  end

  def test_same_version_sources_get_unique_records_and_retries_keep_the_existing_build
    first = reserve
    @source = "b" * 40
    second = reserve
    @source = "a" * 40
    retry_record = reserve
    assert_equal [43, 44, 43],
                 [first, second, retry_record].map { |record|
                   record.data.fetch("build_number")
                 }
    assert_equal "folding/build-43", first.data.fetch("tag")
    assert_equal "folding/build-44", second.data.fetch("tag")
    assert_equal first.data.fetch("release_id"),
                 retry_record.data.fetch("release_id")
    assert_equal 2,
                 @stores
                   .fetch(FoldingRelease::CONFIG.fetch("reservation_tag"))
                   .latest("reservations")
                   .fetch("reservations")
                   .length
  end

  def test_removed_environment_cannot_reserve_builds
    assert_raises(RuntimeError) { reserve("staging") }
  end

  def test_cas_collision_reloads_the_winner_before_allocating
    @stores[FoldingRelease::CONFIG.fetch("reservation_tag")].collide_once = true
    record = reserve
    assert_equal 44, record.data.fetch("build_number")
    ledger =
      @stores.fetch(FoldingRelease::CONFIG.fetch("reservation_tag")).latest(
        "reservations"
      )
    assert_equal [43, 44],
                 ledger
                   .fetch("reservations")
                   .map { |entry| entry.fetch("build_number") }
    assert_equal @source, ledger.fetch("reservations").last.fetch("commit_sha")
  end

  def test_legacy_version_tags_remain_readable_but_cannot_create_new_records
    assert FoldingRelease::GitHubArtifacts.new("v1.0.0")
    assert_raises(RuntimeError) { reserve(tag: "v1.0.0") }
    assert_empty @stores.fetch(
                   FoldingRelease::CONFIG.fetch("reservation_tag")
                 ).assets
  end

  def test_interrupted_archive_replacement_has_a_new_immutable_tag_and_retries_follow_it
    first = reserve
    replacement = reserve(replacement_for: first.data.fetch("release_id"))
    assert_equal [43, 44],
                 [first, replacement].map { |record|
                   record.data.fetch("build_number")
                 }
    assert_equal "folding/build-43", first.data.fetch("tag")
    assert_equal "folding/build-44", replacement.data.fetch("tag")
    first.save(
      "cancelled" => true,
      "replacement_tag" => replacement.data.fetch("tag")
    )
    retried = reserve
    assert_equal replacement.data.fetch("release_id"),
                 retried.data.fetch("release_id")
    assert_equal 43,
                 @stores
                   .fetch("folding/build-43")
                   .latest("manifest")
                   .fetch("build_number")
  end
end
