require_relative "release_manifest"
require_relative "../../../../scripts/duo-host"

module FoldingRelease
  module Assets
    PLAN =
      FoldingRelease.read_json(File.join(ROOT, "fastlane/screenshot-plan.json"))
    LOCALES =
      FoldingRelease.read_json(File.join(ROOT, "fastlane/locales.json")).fetch(
        "locales"
      )
    SOURCE =
      FoldingRelease.read_json(File.join(ROOT, "fastlane/metadata-source.json"))

    def self.png_size(path)
      header = File.binread(path, 24)
      unless header.start_with?("\x89PNG\r\n\x1a\n".b)
        raise "Expected PNG: #{File.basename(path)}"
      end
      header.byteslice(16, 8).unpack("NN")
    end

    def self.validate_metadata!
      unless PLAN.fetch("fixture_version") == CONFIG.fetch("fixture_version")
        raise "Fixture version differs from release config"
      end
      LOCALES.each do |locale|
        directory =
          File.join(
            ROOT,
            "fastlane/metadata",
            locale.fetch("storefront_locale")
          )
        {
          "name" => 30,
          "subtitle" => 30,
          "keywords" => 100,
          "description" => 4000,
          "promotional_text" => 170,
          "release_notes" => 4000
        }.each do |field, maximum|
          text = File.read(File.join(directory, "#{field}.txt")).strip
          if text.empty? || text.length > maximum
            raise "Invalid metadata length: #{locale["storefront_locale"]}/#{field}"
          end
          unless text ==
                   SOURCE
                     .fetch("locales")
                     .fetch(locale.fetch("storefront_locale"))
                     .fetch(field)
                     .strip
            raise "Metadata source/files differ"
          end
        end
      end
    end

    def self.metadata(record)
      validate_metadata!
      directory = File.join(record.directory, "assets/metadata")
      if File.exist?(directory)
        raise "Metadata output exists; resume its manifest instead of overwriting"
      end
      FileUtils.mkdir_p(directory)
      FileUtils.cp_r(
        Dir.glob(File.join(ROOT, "fastlane/metadata/*")),
        directory
      )
      copyright = ENV["FOLDING_COPYRIGHT"]
      if copyright && !copyright.strip.empty?
        File.write(
          File.join(directory, "copyright.txt"),
          copyright.strip + "\n"
        )
      end
      manifest = {
        "schema_version" => 1,
        "commit_sha" => record.data.fetch("commit_sha"),
        "configuration_hash" => record.data.fetch("configuration_hash"),
        "translation_status" => SOURCE.fetch("translations_status"),
        "files" =>
          Dir
            .glob(File.join(directory, "**/*.txt"))
            .sort
            .to_h do |file|
              [file.delete_prefix(directory + "/"), FoldingRelease.sha(file)]
            end
      }
      FoldingRelease.atomic_json(
        File.join(record.directory, "assets/metadata-manifest.json"),
        manifest
      )
    end

    def self.localized_scenes(scenes, locale)
      strings =
        FoldingRelease.read_json(
          File.join(ROOT, "apps/ios/App/Localizable.xcstrings")
        ).fetch("strings")
      scenes.map do |scene|
        title =
          strings
            .fetch(scene.fetch("title_key"))
            .fetch("localizations")
            .fetch(locale.fetch("app_locale"))
            .fetch("stringUnit")
            .fetch("value")
        raise "Capture scene title is empty" if title.strip.empty?
        scene.merge("title" => title)
      end
    end

    def self.capture(context, record, review_only: false)
      record.verify_identity!
      FoldingRelease.clean_commit!
      output = File.join(record.directory, "assets")
      if review_only &&
           File.exist?(File.join(output, "tip-review-manifest.json"))
        return validate_tip_review!(record)
      end
      if File.exist?(File.join(output, "screenshot-manifest.json"))
        raise "Screenshot manifest already exists; reuse verified assets"
      end
      FileUtils.mkdir_p(output)
      entries = []
      displays =
        PLAN
          .fetch("devices")
          .select do |display|
            !review_only || display.fetch("id") == "duo-outer"
          end
      runtimes =
        JSON.parse(
          FoldingRelease.run("xcrun", "simctl", "list", "runtimes", "-j")
        ).fetch("runtimes")
      displays
        .group_by do |display|
          display.fetch("device_type", PLAN.fetch("device_type"))
        end
        .each do |type, group|
          runtime = group.first.fetch("runtime", PLAN.fetch("runtime"))
          runtime_build =
            group.first.fetch("runtime_build", PLAN.fetch("runtime_build"))
          installed =
            runtimes.find do |item|
              item["identifier"] == runtime && item["isAvailable"]
            end
          unless installed && installed["buildversion"] == runtime_build
            raise "Required screenshot runtime unavailable: #{runtime} (#{runtime_build})"
          end
          name = "Folding Capture #{SecureRandom.hex(6)}"
          device =
            FoldingRelease.run("xcrun", "simctl", "create", name, type, runtime)
          controller = nil
          begin
            puts JSON.generate(
                   {
                     "event" => "storefront_capture",
                     "stage" => "booting_device",
                     "device_name" => name,
                     "device_type" => type
                   }
                 )
            FoldingRelease.run("xcrun", "simctl", "boot", device)
            FoldingRelease.run("xcrun", "simctl", "bootstatus", device, "-b")
            FoldingRelease.run(
              "xcrun",
              "simctl",
              "status_bar",
              device,
              "override",
              "--time",
              "9:41",
              "--dataNetwork",
              "wifi",
              "--wifiMode",
              "active",
              "--wifiBars",
              "3",
              "--cellularMode",
              "active",
              "--cellularBars",
              "4",
              "--operatorName",
              "",
              "--batteryState",
              "discharging",
              "--batteryLevel",
              "100"
            )
            native_directory = File.join(output, "native-control")
            if group.any? { |display| display.fetch("id").start_with?("duo-") }
              controller =
                DuoHost.new(
                  directory: native_directory,
                  device_name: name,
                  device_id: device
                ).start
              controller.capture_bridge(
                output: File.join(output, "raw", "native-displays")
              )
            end
            LOCALES.each do |locale|
              if review_only && locale.fetch("storefront_locale") != "en-US"
                next
              end
              scenes = review_only ? [] : PLAN.fetch("scenarios")
              reviews =
                PLAN
                  .fetch("review_scenarios")
                  .select do |scene|
                    group.any? do |display|
                      display["id"] == scene["device_id"]
                    end &&
                      scene["storefront_locale"] == locale["storefront_locale"]
                  end
              scenes =
                scenes +
                  reviews.map do |scene|
                    {
                      "id" => scene.fetch("id"),
                      "appearance" => "light",
                      "device_id" => scene.fetch("device_id"),
                      "title_key" => scene.fetch("title_key")
                    }
                  end
              export =
                File.join(
                  output,
                  "raw",
                  group.first.fetch("id"),
                  locale.fetch("storefront_locale")
                )
              result =
                File.join(
                  output,
                  "results",
                  "#{group.first.fetch("id")}-#{locale.fetch("storefront_locale")}.xcresult"
                )
              environment = {
                "TEST_RUNNER_FOLDING_CAPTURE_DISPLAYS" =>
                  JSON.generate(group.reverse),
                "TEST_RUNNER_FOLDING_CAPTURE_SCENES" =>
                  JSON.generate(localized_scenes(scenes, locale)),
                "TEST_RUNNER_FOLDING_CAPTURE_LOCALE" =>
                  locale.fetch("app_locale"),
                "TEST_RUNNER_FOLDING_CAPTURE_REGION" =>
                  locale.fetch("test_region"),
                "TEST_RUNNER_DUO_HOST_CONTROL_DIR" =>
                  controller ? native_directory : nil
              }
              previous = environment.keys.to_h { |key| [key, ENV[key]] }
              begin
                environment.each { |key, value| ENV[key] = value }
                puts JSON.generate(
                       {
                         "event" => "storefront_capture",
                         "stage" => "capturing_screens",
                         "displays" =>
                           group.map { |display| display.fetch("id") },
                         "locale" => locale.fetch("storefront_locale")
                       }
                     )
                context.run_tests(
                  project: File.join(ROOT, "apps/ios/Folding.xcodeproj"),
                  scheme: PLAN.fetch("scheme"),
                  configuration: PLAN.fetch("configuration"),
                  destination: "platform=iOS Simulator,id=#{device}",
                  only_testing: [
                    "#{PLAN.fetch("test_target")}/StorefrontCaptureTests/testCaptureScreens"
                  ],
                  derived_data_path:
                    File.join(ROOT, "build/screenshot-release"),
                  result_bundle: true,
                  result_bundle_path: result,
                  output_directory:
                    File.join(
                      output,
                      "logs",
                      group.first.fetch("id"),
                      locale.fetch("storefront_locale")
                    ),
                  xcargs:
                    "-testLanguage #{locale.fetch("app_locale")} -testRegion #{locale.fetch("test_region")}",
                  parallel_testing: false,
                  concurrent_workers: 1,
                  skip_slack: true,
                  xcodebuild_formatter: ""
                )
              ensure
                previous.each { |key, value| ENV[key] = value }
              end
              FoldingRelease.run(
                "xcrun",
                "xcresulttool",
                "export",
                "attachments",
                "--path",
                result,
                "--output-path",
                export
              )
              attachments =
                FoldingRelease
                  .read_json(File.join(export, "manifest.json"))
                  .flat_map { |test| test.fetch("attachments") }
              group.each do |display|
                find_capture =
                  lambda do |scene|
                    if controller
                      pose = display.fetch("id").delete_prefix("duo-")
                      name =
                        "storefront-#{locale.fetch("app_locale")}-#{display.fetch("id")}-#{scene.fetch("id")}".downcase
                      path =
                        File.join(
                          output,
                          "raw",
                          "native-displays",
                          "#{pose}-#{scene.fetch("appearance", "light")}-#{name}.png"
                        )
                      unless File.file?(path) &&
                               png_size(path) ==
                                 display.values_at(
                                   "pixel_width",
                                   "pixel_height"
                                 )
                        raise "Missing/wrong native display capture: #{name}"
                      end
                      next path
                    end
                    prefix =
                      "storefront-#{locale.fetch("app_locale")}-#{display.fetch("id")}-#{scene.fetch("id")}_"
                    matches =
                      attachments.select do |item|
                        item.fetch("suggestedHumanReadableName").start_with?(
                          prefix
                        ) && item.fetch("exportedFileName").end_with?(".png")
                      end
                    unless matches.one?
                      raise "Missing/duplicate native screen capture: #{prefix}"
                    end
                    path =
                      File.join(export, matches.first.fetch("exportedFileName"))
                    unless png_size(path) ==
                             display.values_at("pixel_width", "pixel_height")
                      raise "Wrong native screen dimensions: #{prefix}"
                    end
                    path
                  end
                (review_only ? [] : PLAN.fetch("scenarios")).each do |scene|
                  entries << stage_capture(
                    record,
                    find_capture.call(scene),
                    display,
                    locale,
                    scene
                  )
                end
                reviews
                  .select { |scene| scene["device_id"] == display["id"] }
                  .each do |scene|
                    package_tip_review(
                      record,
                      find_capture.call(scene),
                      display,
                      locale,
                      scene
                    )
                  end
              end
            end
          ensure
            controller&.close
            system(
              "xcrun",
              "simctl",
              "shutdown",
              device,
              out: File::NULL,
              err: File::NULL
            )
            system(
              "xcrun",
              "simctl",
              "delete",
              device,
              out: File::NULL,
              err: File::NULL
            )
          end
        end
      return validate_tip_review!(record) if review_only
      manifest = {
        "schema_version" => 2,
        "commit_sha" => record.data.fetch("commit_sha"),
        "configuration_hash" => record.data.fetch("configuration_hash"),
        "entries" => entries
      }
      FoldingRelease.atomic_json(
        File.join(output, "screenshot-manifest.json"),
        manifest
      )
      FoldingRelease.clean_commit!
      validate!(record)
    end

    def self.package_tip_review(record, raw, display, locale, scenario)
      output = File.join(record.directory, "assets")
      unless png_size(raw) == display.values_at("pixel_width", "pixel_height")
        raise "Wrong tip review display dimensions"
      end
      relative =
        "review/tipjar-#{locale.fetch("storefront_locale")}-#{display.fetch("id")}.png"
      destination = File.join(output, relative)
      FileUtils.mkdir_p(File.dirname(destination))
      if File.exist?(destination)
        raise "Tip review image already exists; reconcile the unfinished capture"
      end
      stage_png(raw, destination)
      map =
        CONFIG.fetch("tip_product_ids").to_h { |product| [product, relative] }
      FoldingRelease.atomic_json(
        File.join(output, "tip-review-screenshots.json"),
        map
      )
      manifest = {
        "schema_version" => 2,
        "purpose" => "in_app_purchase_review",
        "capture_method" => PLAN.fetch("capture_method"),
        "commit_sha" => record.data.fetch("commit_sha"),
        "configuration_hash" => record.data.fetch("configuration_hash"),
        "fixture_version" => PLAN.fetch("fixture_version"),
        "fixed_clock" => PLAN.fetch("fixed_clock"),
        "device_id" => display.fetch("id"),
        "device_model" => display.fetch("model"),
        "runtime" => PLAN.fetch("runtime"),
        "runtime_build" => PLAN.fetch("runtime_build"),
        "app_locale" => locale.fetch("app_locale"),
        "storefront_locale" => locale.fetch("storefront_locale"),
        "appearance" => PLAN.fetch("appearance"),
        "scenario_id" => scenario.fetch("id"),
        "pixel_width" => display.fetch("pixel_width"),
        "pixel_height" => display.fetch("pixel_height"),
        "raw_path" => relative,
        "raw_sha256" => FoldingRelease.sha(destination),
        "map_sha256" =>
          FoldingRelease.sha(File.join(output, "tip-review-screenshots.json")),
        "product_source_sha256" =>
          FoldingRelease.sha(File.join(ROOT, "fastlane/tip-products.json")),
        "product_ids" => CONFIG.fetch("tip_product_ids"),
        "visual_review" => "pending"
      }
      FoldingRelease.atomic_json(
        File.join(output, "tip-review-manifest.json"),
        manifest
      )
    end

    def self.validate_tip_review!(record)
      output = File.join(record.directory, "assets")
      manifest =
        FoldingRelease.read_json(File.join(output, "tip-review-manifest.json"))
      unless manifest["schema_version"] == 2 &&
               manifest["capture_method"] == "simulator_screen" &&
               manifest["purpose"] == "in_app_purchase_review" &&
               manifest["commit_sha"] == record.data["commit_sha"] &&
               manifest["configuration_hash"] ==
                 record.data["configuration_hash"] &&
               manifest["fixture_version"] == PLAN["fixture_version"] &&
               manifest["fixed_clock"] == PLAN["fixed_clock"]
        raise "Tip review capture identity mismatch"
      end
      scene =
        PLAN
          .fetch("review_scenarios")
          .find { |candidate| candidate["id"] == manifest["scenario_id"] }
      unless scene && scene["device_id"] == manifest["device_id"] &&
               scene["storefront_locale"] == manifest["storefront_locale"] &&
               scene["app_locale"] == manifest["app_locale"]
        raise "Unexpected tip review scenario/locale"
      end
      display =
        PLAN
          .fetch("devices")
          .find { |candidate| candidate["id"] == scene["device_id"] }
      unless manifest["runtime"] == PLAN["runtime"] &&
               manifest["runtime_build"] == PLAN["runtime_build"] &&
               manifest["appearance"] == PLAN["appearance"]
        raise "Tip review runtime or appearance changed"
      end
      file = File.expand_path(manifest.fetch("raw_path"), output)
      unless file.start_with?(File.join(output, "review") + "/")
        raise "Invalid tip review image path"
      end
      unless FoldingRelease.sha(file) == manifest["raw_sha256"] &&
               png_size(file) ==
                 display.values_at("pixel_width", "pixel_height") &&
               manifest.values_at("pixel_width", "pixel_height") ==
                 display.values_at("pixel_width", "pixel_height")
        raise "Tip review image bytes/dimensions changed"
      end
      map_path = File.join(output, "tip-review-screenshots.json")
      unless FoldingRelease.sha(map_path) == manifest["map_sha256"]
        raise "Tip review map changed"
      end
      map = FoldingRelease.read_json(map_path)
      expected = CONFIG.fetch("tip_product_ids")
      unless map.keys.sort == expected.sort &&
               manifest.fetch("product_ids").sort == expected.sort &&
               map.values.all? { |path| path == manifest.fetch("raw_path") }
        raise "Tip review product mapping incomplete"
      end
      unless manifest["product_source_sha256"] ==
               FoldingRelease.sha(File.join(ROOT, "fastlane/tip-products.json"))
        raise "Tip product source changed since capture"
      end
      map_path
    end

    def self.stage_capture(record, raw, display, locale, scenario)
      output = File.join(record.directory, "assets")
      destination =
        File.join(
          output,
          "screenshots",
          locale.fetch("storefront_locale"),
          "%02d-%s-%s.png" %
            [
              scenario.fetch("order") * 2 -
                (display.fetch("id") == "duo-inner" ? 0 : 1),
              display.fetch("id"),
              scenario.fetch("id")
            ]
        )
      FileUtils.mkdir_p(File.dirname(destination))
      unless png_size(raw) == display.values_at("pixel_width", "pixel_height")
        raise "Native screenshot dimensions changed"
      end
      # Preserve the simulator image; only fully opaque alpha is removed if needed by Apple.
      stage_png(raw, destination)
      {
        "commit_sha" => record.data.fetch("commit_sha"),
        "configuration_hash" => record.data.fetch("configuration_hash"),
        "fixture_version" => PLAN.fetch("fixture_version"),
        "fixed_clock" => PLAN.fetch("fixed_clock"),
        "app_locale" => locale.fetch("app_locale"),
        "storefront_locale" => locale.fetch("storefront_locale"),
        "device_id" => display.fetch("id"),
        "device_model" => display.fetch("model"),
        "runtime" => display.fetch("runtime", PLAN.fetch("runtime")),
        "runtime_build" =>
          display.fetch("runtime_build", PLAN.fetch("runtime_build")),
        "pixel_width" => display.fetch("pixel_width"),
        "pixel_height" => display.fetch("pixel_height"),
        "capture_method" => PLAN.fetch("capture_method"),
        "raw_pixel_size" => png_size(raw),
        "appearance" => scenario.fetch("appearance"),
        "scenario_id" => scenario.fetch("id"),
        "raw_path" => raw.delete_prefix(output + "/"),
        "composed_path" => destination.delete_prefix(output + "/"),
        "raw_sha256" => FoldingRelease.sha(raw),
        "composed_sha256" => FoldingRelease.sha(destination),
        "plan_sha256" =>
          FoldingRelease.sha(File.join(ROOT, "fastlane/screenshot-plan.json")),
        "png_processor_sha256" =>
          FoldingRelease.sha(
            File.join(ROOT, "fastlane/scripts/opaque-screen.swift")
          ),
        "upload_display_type" => display.fetch("upload_display_type")
      }
    end

    def self.stage_png(source, destination)
      raise "Screenshot destination already exists" if File.exist?(destination)
      if File.binread(source, 26).getbyte(25) == 2
        FileUtils.cp(source, destination)
      else
        tool =
          File.join(
            ROOT,
            "build/screenshot-tools",
            FoldingRelease.sha(
              File.join(ROOT, "fastlane/scripts/opaque-screen.swift")
            ),
            "opaque-screen"
          )
        unless File.exist?(tool)
          FileUtils.mkdir_p(File.dirname(tool))
          FoldingRelease.run(
            "swiftc",
            File.join(ROOT, "fastlane/scripts/opaque-screen.swift"),
            "-o",
            tool
          )
        end
        FoldingRelease.run(tool, source, destination)
      end
    end

    def self.validate!(record)
      validate_tip_review!(record)
      output = File.join(record.directory, "assets")
      manifest =
        FoldingRelease.read_json(File.join(output, "screenshot-manifest.json"))
      unless manifest["schema_version"] == 2 &&
               manifest["commit_sha"] == record.data["commit_sha"] &&
               manifest["configuration_hash"] ==
                 record.data["configuration_hash"]
        raise "Screenshot identity mismatch"
      end
      expected =
        LOCALES.flat_map do |locale|
          PLAN
            .fetch("devices")
            .flat_map do |device|
              PLAN
                .fetch("scenarios")
                .map do |scenario|
                  [
                    locale.fetch("storefront_locale"),
                    device.fetch("id"),
                    scenario.fetch("id")
                  ]
                end
            end
        end
      entries = manifest.fetch("entries")
      actual =
        entries.map do |entry|
          entry.values_at("storefront_locale", "device_id", "scenario_id")
        end
      unless actual.sort == expected.sort
        raise "Incomplete/duplicate screenshot matrix"
      end
      entries.each do |entry|
        display =
          PLAN
            .fetch("devices")
            .find { |candidate| candidate["id"] == entry["device_id"] }
        unless entry.values_at(
                 "pixel_width",
                 "pixel_height",
                 "upload_display_type"
               ) ==
                 display.values_at(
                   "pixel_width",
                   "pixel_height",
                   "upload_display_type"
                 )
          raise "Native device specification changed"
        end
        %w[raw composed].each do |kind|
          path = File.expand_path(entry.fetch("#{kind}_path"), output)
          raise "Invalid screenshot path" unless path.start_with?(output + "/")
          unless FoldingRelease.sha(path) == entry.fetch("#{kind}_sha256")
            raise "Screenshot content changed"
          end
        end
        unless entry["capture_method"] == "simulator_screen" &&
                 entry["plan_sha256"] ==
                   FoldingRelease.sha(
                     File.join(ROOT, "fastlane/screenshot-plan.json")
                   )
          raise "Native capture plan changed"
        end
        unless entry["png_processor_sha256"] ==
                 FoldingRelease.sha(
                   File.join(ROOT, "fastlane/scripts/opaque-screen.swift")
                 )
          raise "PNG processor changed"
        end
        unless entry["raw_pixel_size"] ==
                 entry.values_at("pixel_width", "pixel_height")
          raise "Native capture was resized"
        end
        unless File.binread(
                 File.join(output, entry.fetch("composed_path")),
                 26
               ).getbyte(25) == 2
          raise "Store screenshot contains an alpha channel"
        end
        if File.binread(File.join(output, entry.fetch("raw_path")), 26).getbyte(
             25
           ) == 2
          unless entry["raw_sha256"] == entry["composed_sha256"]
            raise "Native RGB screenshot was modified"
          end
        end
        require "deliver/app_screenshot"
        path = File.join(output, entry.fetch("composed_path"))
        unless Deliver::AppScreenshot.calculate_display_type(path) ==
                 entry.fetch("upload_display_type")
          raise "Fastlane screenshot slot mismatch"
        end
        unless png_size(File.join(output, entry.fetch("composed_path"))) ==
                 entry.values_at("pixel_width", "pixel_height")
          raise "Screenshot output dimensions changed"
        end
      end
      entries
        .group_by do |entry|
          entry.values_at("storefront_locale", "upload_display_type")
        end
        .each_value do |gallery|
          if gallery.length > 10
            raise "Apple screenshot gallery exceeds ten images"
          end
        end
      record.verify_identity!
      metadata =
        FoldingRelease.read_json(File.join(output, "metadata-manifest.json"))
      unless metadata["commit_sha"] == record.data["commit_sha"] &&
               metadata["configuration_hash"] ==
                 record.data["configuration_hash"]
        raise "Metadata identity mismatch"
      end
      metadata
        .fetch("files")
        .each do |name, hash|
          path = File.expand_path(name, File.join(output, "metadata"))
          unless path.start_with?(File.join(output, "metadata") + "/")
            raise "Invalid metadata path"
          end
          unless FoldingRelease.sha(path) == hash
            raise "Metadata content changed"
          end
        end
      true
    end
  end
end

module FoldingRelease
  # Unprivileged screenshots require neither Apple credentials nor GitHub artifact access.
  class LocalCaptureRecord
    attr_reader :data, :directory
    def initialize(environment: "production")
      source = FoldingRelease.clean_commit!
      @data = {
        "commit_sha" => source,
        "configuration_hash" => FoldingRelease.configuration_hash(environment),
        "environment" => environment
      }
      @directory = File.join(ROOT, "build/store-assets", source, environment)
    end

    def verify_identity!
      unless data["commit_sha"] == FoldingRelease.commit &&
               data["configuration_hash"] ==
                 FoldingRelease.configuration_hash(data.fetch("environment"))
        raise "Capture source/configuration changed"
      end
    end
  end
end
