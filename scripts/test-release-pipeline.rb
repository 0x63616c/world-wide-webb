require "minitest/autorun"
require "ostruct"
require "tmpdir"
require_relative "release-pipeline"
require_relative "check-release"

class ReleasePipelineTest < Minitest::Test
  def row(state, version = "1.1.0")
    {
      "id" => "v",
      "attributes" => {
        "appVersionState" => state,
        "versionString" => version
      }
    }
  end

  def test_live_version_gets_new_patch_without_downgrade
    assert_equal ["1.1.1", nil],
                 ReleasePipeline.version(
                   [
                     row("REPLACED_WITH_NEW_VERSION", "1.0.0"),
                     row("READY_FOR_DISTRIBUTION")
                   ],
                   "1.1.0"
                 )
    assert_equal ["2.0", nil],
                 ReleasePipeline.version([row("READY_FOR_SALE")], "2.0")
    assert_equal ["1.2.11", nil],
                 ReleasePipeline.version(
                   [row("READY_FOR_SALE", "1.2.10")],
                   "1.1.0"
                 )
  end

  def test_retry_reuses_editable_version
    assert_equal %w[1.1.1 v],
                 ReleasePipeline.version(
                   [
                     row("READY_FOR_SALE"),
                     row("PREPARE_FOR_SUBMISSION", "1.1.1")
                   ],
                   "1.1.0"
                 )
  end

  def test_purchase_review_defers_even_after_app_approval
    %w[WAITING_FOR_REVIEW IN_REVIEW CANCELING COMPLETING].each do |state|
      assert_raises(ReleasePipeline::Deferred) do
        ReleasePipeline.require_idle_reviews!(
          [{ "attributes" => { "state" => state } }]
        )
      end
    end
    ReleasePipeline.require_idle_reviews!(
      [{ "attributes" => { "state" => "COMPLETE" } }]
    )
  end

  def test_active_or_unrecognized_states_never_get_replaced
    %w[
      WAITING_FOR_REVIEW
      IN_REVIEW
      PENDING_DEVELOPER_RELEASE
      PROCESSING_FOR_DISTRIBUTION
      ACCEPTED
      NEW_APPLE_STATE
    ].each do |state|
      assert_raises(ReleasePipeline::Deferred) do
        ReleasePipeline.version([row(state)], "1.1.0")
      end
    end
  end

  def test_tagged_release_advances_an_older_editable_draft
    Dir.mktmpdir do |dir|
      ENV["GITHUB_SHA"] = "tested-source"
      ENV["GITHUB_ENV"] = File.join(dir, "environment")
      rows = [row("PREPARE_FOR_SUBMISSION", "1.1.1")]
      writes = []
      api = Object.new
      api.define_singleton_method(:get) do |path|
        data = path.include?("appStoreVersions?") ? rows : []
        OpenStruct.new(body: { "data" => data })
      end
      api.define_singleton_method(:patch) do |path, body|
        writes << [path, body]
      end
      api.define_singleton_method(:post) do |*|
        raise "Must reuse the editable draft"
      end
      Spaceship::ConnectAPI.client = OpenStruct.new(tunes_request_client: api)
      lane = ReleaseCheck.new
      lane.define_singleton_method(:r_app) do |_|
        { "slug" => "tendr", "version" => "1.1.2" }
      end
      lane.define_singleton_method(:app_store_app) do |_|
        OpenStruct.new(id: "app")
      end
      ReleaseSource.stub(:current!, nil) { lane.plan_release(app: "tendr") }
      assert_equal [
                     [
                       "v1/appStoreVersions/v",
                       {
                         data: {
                           type: "appStoreVersions",
                           id: "v",
                           attributes: {
                             versionString: "1.1.2"
                           }
                         }
                       }
                     ]
                   ],
                   writes
      assert_includes File.read(ENV["GITHUB_ENV"]), "RELEASE_VERSION=1.1.2"
    ensure
      Spaceship::ConnectAPI.client = nil
      ENV.delete("GITHUB_SHA")
      ENV.delete("GITHUB_ENV")
    end
  end

  def test_finish_lane_never_submits_without_verified_uploaded_images
    Dir.mktmpdir do |dir|
      config = {
        "slug" => "tendr",
        "name" => "Tendr",
        "dir" => dir,
        "screenshots_path" => dir,
        "app_store_automatic" => true
      }
      File.write(
        File.join(dir, "screenshots.json"),
        JSON.generate({ duo_shots: [{ screen: "home" }] })
      )
      ENV["RELEASE_MANIFEST"] = File.join(dir, "manifest.json")
      ENV["GITHUB_SHA"] = "source-revision"
      ENV["GITHUB_STEP_SUMMARY"] = File.join(dir, "summary")
      ENV["GITHUB_ENV"] = File.join(dir, "environment")
      File.write(
        ENV["RELEASE_MANIFEST"],
        JSON.generate(
          { app: "tendr", sha: "source-revision", version: "1.1.1", build: "8" }
        )
      )
      build_api = Object.new
      build_api.define_singleton_method(:get) do |path, _params = nil|
        raise path unless path == "v1/builds"
        OpenStruct.new(
          body: {
            "data" => [
              {
                "id" => "build-8",
                "attributes" => {
                  "version" => "8",
                  "processingState" => "VALID",
                  "expired" => false
                }
              }
            ]
          }
        )
      end
      Spaceship::ConnectAPI.client =
        OpenStruct.new(tunes_request_client: build_api)
      lane = ReleaseCheck.new
      events = []
      lane.define_singleton_method(:r_app) { |_| config }
      lane.define_singleton_method(:prepare_review) do |**opts|
        events << [:prepare, opts]
      end
      lane.define_singleton_method(:app_store_app) do |_|
        OpenStruct.new(id: "app")
      end
      lane.define_singleton_method(:editable_app_store_version) do |_|
        OpenStruct.new(id: "v", version_string: "1.1.1")
      end
      lane.define_singleton_method(:submit_with_iap) do |**opts|
        events << [:submit, opts]
      end
      # Real verifier fails before making requests if no screenshots were staged.
      assert_raises(RuntimeError) do
        ReleaseSource.stub(:current!, nil) { lane.finish_release(app: "tendr") }
      end
      assert_empty events
      events.clear
      FileUtils.mkdir_p(File.join(dir, "en-US"))
      shots =
        %w[inner outer].map do |pose|
          name = "duo-01-#{pose}-home.png"
          File.write(File.join(dir, "en-US", name), "fixture-#{pose}")
          {
            "attributes" => {
              "fileName" => name,
              "sourceFileChecksum" => Digest::MD5.hexdigest("fixture-#{pose}"),
              "assetDeliveryState" => {
                "state" => "COMPLETE"
              }
            }
          }
        end
      api = Object.new
      reviews = []
      api.define_singleton_method(:get) do |path, params = nil|
        next build_api.get(path, params) if path == "v1/builds"
        data =
          case path
          when /appStoreVersionLocalizations$/
            [{ "id" => "loc", "attributes" => { "locale" => "en-US" } }]
          when /appScreenshotSets$/
            [
              {
                "id" => "set",
                "attributes" => {
                  "screenshotDisplayType" => "APP_IPHONE_DUO"
                }
              }
            ]
          when /appScreenshots$/
            shots
          when /reviewSubmissions\?/
            reviews
          else
            raise path
          end
        OpenStruct.new(body: { "data" => data })
      end
      Spaceship::ConnectAPI.client = OpenStruct.new(tunes_request_client: api)
      ReleaseSource.stub(:current!, nil) { lane.finish_release(app: "tendr") }
      assert_equal %i[prepare submit], events.map(&:first)
      assert_equal(
        {
          app: "tendr",
          version: "1.1.1",
          build: "8",
          dry_run: false,
          required_targets: [],
          automatic: true
        },
        events.last.last
      )
      assert_includes File.read(ENV["GITHUB_STEP_SUMMARY"]),
                      "Apple review is pending"
      state_path = File.expand_path("../build/release-state.json", __dir__)
      assert_equal "submitted", JSON.parse(File.read(state_path)).fetch("state")
      File.delete(state_path)
      events.clear
      reviews << { "attributes" => { "state" => "IN_REVIEW" } }
      ReleaseSource.stub(:current!, nil) { lane.finish_release(app: "tendr") }
      assert_empty events
      assert_equal "deferred", JSON.parse(File.read(state_path)).fetch("state")
      assert_includes File.read(ENV["GITHUB_ENV"]), "RELEASE_SKIP=true"
      File.delete(state_path)
      reviews.clear
      File.write(
        ENV["RELEASE_MANIFEST"],
        JSON.generate(
          { app: "tendr", sha: "wrong-source", version: "1.1.1", build: "8" }
        )
      )
      assert_raises(RuntimeError) do
        ReleaseSource.stub(:current!, nil) { lane.finish_release(app: "tendr") }
      end
      assert_empty events
    ensure
      Spaceship::ConnectAPI.client = nil
      ENV.delete("RELEASE_MANIFEST")
      ENV.delete("GITHUB_STEP_SUMMARY")
      ENV.delete("GITHUB_SHA")
      ENV.delete("GITHUB_ENV")
    end
  end

  def test_screenshot_verification_checks_apple_bytes_state_and_gallery
    Dir.mktmpdir do |dir|
      File.write(File.join(dir, "duo-01-inner-home.png"), "fixture")
      shot = {
        "attributes" => {
          "fileName" => "duo-01-inner-home.png",
          "sourceFileChecksum" => Digest::MD5.hexdigest("fixture"),
          "assetDeliveryState" => {
            "state" => "COMPLETE"
          }
        }
      }
      gallery = {
        "id" => "set",
        "attributes" => {
          "screenshotDisplayType" => "APP_IPHONE_DUO"
        }
      }
      api = Object.new
      api.define_singleton_method(:get) do |path|
        data =
          case path
          when /appStoreVersionLocalizations$/
            [{ "id" => "loc", "attributes" => { "locale" => "en-US" } }]
          when /appScreenshotSets$/
            [gallery]
          when /appScreenshots$/
            [shot]
          else
            raise path
          end
        OpenStruct.new(body: { "data" => data })
      end
      assert_equal 1, ReleasePipeline.screenshots!(api, "v", dir, 1)
      shot["attributes"]["sourceFileChecksum"] = "old"
      assert_raises(RuntimeError) do
        ReleasePipeline.screenshots!(api, "v", dir, 1)
      end
      shot["attributes"]["sourceFileChecksum"] = Digest::MD5.hexdigest(
        "fixture"
      )
      shot["attributes"]["assetDeliveryState"]["state"] = "FAILED"
      assert_raises(RuntimeError) do
        ReleasePipeline.screenshots!(api, "v", dir, 1)
      end
      shot["attributes"]["assetDeliveryState"]["state"] = "COMPLETE"
      gallery["attributes"]["screenshotDisplayType"] = "APP_IPHONE_67"
      assert_raises(RuntimeError) do
        ReleasePipeline.screenshots!(api, "v", dir, 1)
      end
      assert_raises(RuntimeError) do
        ReleasePipeline.screenshots!(api, "v", dir, 2)
      end
    end
  end
end
