require_relative "release_manifest"

module FoldingRelease
  module Assets
    PLAN = FoldingRelease.read_json(File.join(ROOT, "fastlane/screenshot-plan.json"))
    LOCALES = FoldingRelease.read_json(File.join(ROOT, "fastlane/locales.json")).fetch("locales")
    SOURCE = FoldingRelease.read_json(File.join(ROOT, "fastlane/metadata-source.json"))

    def self.png_size(path)
      header = File.binread(path, 24)
      raise "Expected PNG: #{File.basename(path)}" unless header.start_with?("\x89PNG\r\n\x1a\n".b)
      header.byteslice(16, 8).unpack("NN")
    end

    def self.validate_metadata!
      LOCALES.each do |locale|
        directory = File.join(ROOT, "fastlane/metadata", locale.fetch("storefront_locale"))
        {"name" => 30, "subtitle" => 30, "keywords" => 100, "description" => 4000,
         "promotional_text" => 170, "release_notes" => 4000}.each do |field, maximum|
          text = File.read(File.join(directory, "#{field}.txt")).strip
          raise "Invalid metadata length: #{locale['storefront_locale']}/#{field}" if text.empty? || text.length > maximum
          raise "Metadata source/files differ" unless text == SOURCE.fetch("locales").fetch(locale.fetch("storefront_locale")).fetch(field).strip
        end
      end
    end

    def self.metadata(record)
      validate_metadata!
      directory = File.join(record.directory, "assets/metadata")
      raise "Metadata output exists; resume its manifest instead of overwriting" if File.exist?(directory)
      FileUtils.mkdir_p(directory)
      FileUtils.cp_r(Dir.glob(File.join(ROOT, "fastlane/metadata/*")), directory)
      copyright = ENV["FOLDING_COPYRIGHT"]
      File.write(File.join(directory, "copyright.txt"), copyright.strip + "\n") if copyright && !copyright.strip.empty?
      manifest = {"schema_version" => 1, "commit_sha" => record.data.fetch("commit_sha"),
        "configuration_hash" => record.data.fetch("configuration_hash"),
        "translation_status" => SOURCE.fetch("translations_status"),
        "files" => Dir.glob(File.join(directory, "**/*.txt")).sort.to_h { |file| [file.delete_prefix(directory + "/"), FoldingRelease.sha(file)] }}
      FoldingRelease.atomic_json(File.join(record.directory, "assets/metadata-manifest.json"), manifest)
    end

    def self.capture(context, record, review_only: false)
      record.verify_identity!
      FoldingRelease.clean_commit!
      output = File.join(record.directory, "assets")
      if review_only && File.exist?(File.join(output, "tip-review-manifest.json"))
        return validate_tip_review!(record)
      end
      raise "Screenshot manifest already exists; reuse verified assets" if File.exist?(File.join(output, "screenshot-manifest.json"))
      FileUtils.mkdir_p(output)
      name = "Folding Capture #{SecureRandom.hex(6)}"
      device = FoldingRelease.run("xcrun", "simctl", "create", name, PLAN.fetch("device_type"), PLAN.fetch("runtime"))
      entries = []
      begin
        FoldingRelease.run("xcrun", "simctl", "boot", device)
        FoldingRelease.run("xcrun", "simctl", "bootstatus", device, "-b")
        FoldingRelease.run("xcrun", "simctl", "ui", device, "appearance", PLAN.fetch("appearance"))
        FoldingRelease.run("xcrun", "simctl", "status_bar", device, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100")
        PLAN.fetch("devices").each do |display|
          next if review_only && !PLAN.fetch("review_scenarios").any? { |scene| scene["device_id"] == display["id"] }
          PLAN.fetch("devices").each do |screen|
            FoldingRelease.run("xcrun", "simctl", "io", device, "screenConfig", "--display=#{screen.fetch('screen')}", "power", screen == display ? "on" : "off")
          end
          LOCALES.each do |locale|
            review_scenes = PLAN.fetch("review_scenarios").select { |scene| scene["device_id"] == display["id"] && scene["storefront_locale"] == locale["storefront_locale"] }
            next if review_only && review_scenes.empty?
            if File.exist?(File.join(output, "tip-review-manifest.json"))
              validate_tip_review!(record)
              review_scenes = []
            end
            storefront_scenes = review_only ? [] : PLAN.fetch("scenarios")
            next if storefront_scenes.empty? && review_scenes.empty?
            (storefront_scenes + review_scenes).group_by { |scene| scene.fetch("appearance", PLAN.fetch("appearance")) }.each do |appearance, scenes|
              current_storefront = storefront_scenes & scenes
              current_review = review_scenes & scenes
              FoldingRelease.run("xcrun", "simctl", "ui", device, "appearance", appearance)
              raw_dir = File.join(output, "raw", display.fetch("id"), locale.fetch("storefront_locale"), appearance)
              context.capture_screenshots(
                project: File.join(ROOT, "apps/ios/Folding.xcodeproj"), scheme: PLAN.fetch("scheme"),
                app_identifier: "app.getfolding.Folding.Screenshots",
                configuration: PLAN.fetch("configuration"), devices: [name],
                languages: [locale.fetch("snapshot_locale")],
                launch_arguments: ["--folding-screenshot-locale #{locale.fetch('app_locale')} --folding-screenshot-appearance #{appearance}"],
                only_testing: scenes.map { |scenario| "#{PLAN.fetch('test_target')}/FoldingScreenshotTests/#{scenario.fetch('test')}" },
                output_directory: raw_dir, derived_data_path: File.join(ROOT, "build/screenshot-release"),
                clear_previous_screenshots: true, reinstall_app: true,
                concurrent_simulators: false, number_of_retries: 0, skip_open_summary: true,
                override_status_bar: false, xcodebuild_formatter: ""
              )
              current_storefront.each do |scenario|
                matches = Dir.glob(File.join(raw_dir, "**/*#{scenario.fetch('id')}.png"))
                raise "Missing/duplicate current capture" unless matches.length == 1
                raw = matches.first
                raise "Wrong Duo display captured" unless png_size(raw) == [display.fetch("pixel_width"), display.fetch("pixel_height")]
                entries << compose(record, raw, display, locale, scenario)
              end
              current_review.each do |scenario|
                matches = Dir.glob(File.join(raw_dir, "**/*#{scenario.fetch('id')}.png"))
                raise "Missing/duplicate current tip review capture" unless matches.length == 1
                package_tip_review(record, matches.first, display, locale, scenario)
              end
            end
          end
        end
        (review_only ? [] : PLAN.fetch("additional_upload_slots")).each do |slot|
          LOCALES.each do |locale|
            source = entries.find { |entry| entry["device_id"] == slot.fetch("source_device_id") && entry["scenario_id"] == slot.fetch("scenario_id") && entry["storefront_locale"] == locale.fetch("storefront_locale") }
            scenario = PLAN.fetch("scenarios").find { |item| item["id"] == slot.fetch("scenario_id") }
            display = slot.merge("model" => "Duo capture in App Store medium canvas")
            entries << compose(record, File.join(output, source.fetch("raw_path")), display, locale, scenario)
          end
        end
        if review_only
          return validate_tip_review!(record)
        end
        manifest = {"schema_version" => 1, "commit_sha" => record.data.fetch("commit_sha"),
          "configuration_hash" => record.data.fetch("configuration_hash"), "entries" => entries}
        FoldingRelease.atomic_json(File.join(output, "screenshot-manifest.json"), manifest)
        FoldingRelease.clean_commit!
        validate!(record)
      ensure
        # Only the simulator created by this invocation is ever shut down/deleted.
        system("xcrun", "simctl", "shutdown", device, out: File::NULL, err: File::NULL)
        system("xcrun", "simctl", "delete", device, out: File::NULL, err: File::NULL)
      end
    end

    def self.package_tip_review(record, raw, display, locale, scenario)
      output = File.join(record.directory, "assets")
      raise "Wrong tip review display dimensions" unless png_size(raw) == display.values_at("pixel_width", "pixel_height")
      relative = "review/tipjar-#{locale.fetch('storefront_locale')}-#{display.fetch('id')}.png"
      destination = File.join(output, relative)
      FileUtils.mkdir_p(File.dirname(destination))
      raise "Tip review image already exists; reconcile the unfinished capture" if File.exist?(destination)
      FileUtils.cp(raw, destination) # Exact native screenshot bytes, without captions or fake purchase dialogs.
      map = CONFIG.fetch("tip_product_ids").to_h { |product| [product, relative] }
      FoldingRelease.atomic_json(File.join(output, "tip-review-screenshots.json"), map)
      manifest = {"schema_version" => 1, "purpose" => "in_app_purchase_review",
        "commit_sha" => record.data.fetch("commit_sha"), "configuration_hash" => record.data.fetch("configuration_hash"),
        "fixture_version" => PLAN.fetch("fixture_version"), "fixed_clock" => PLAN.fetch("fixed_clock"),
        "device_id" => display.fetch("id"), "device_model" => display.fetch("model"),
        "runtime" => PLAN.fetch("runtime"), "runtime_build" => PLAN.fetch("runtime_build"),
        "app_locale" => locale.fetch("app_locale"), "storefront_locale" => locale.fetch("storefront_locale"),
        "appearance" => PLAN.fetch("appearance"), "scenario_id" => scenario.fetch("id"),
        "pixel_width" => display.fetch("pixel_width"), "pixel_height" => display.fetch("pixel_height"),
        "raw_path" => relative, "raw_sha256" => FoldingRelease.sha(raw),
        "map_sha256" => FoldingRelease.sha(File.join(output, "tip-review-screenshots.json")),
        "product_source_sha256" => FoldingRelease.sha(File.join(ROOT, "fastlane/tip-products.json")),
        "product_ids" => CONFIG.fetch("tip_product_ids"), "visual_review" => "pending"}
      FoldingRelease.atomic_json(File.join(output, "tip-review-manifest.json"), manifest)
    end

    def self.validate_tip_review!(record)
      output = File.join(record.directory, "assets")
      manifest = FoldingRelease.read_json(File.join(output, "tip-review-manifest.json"))
      raise "Tip review capture identity mismatch" unless manifest["schema_version"] == 1 && manifest["purpose"] == "in_app_purchase_review" && manifest["commit_sha"] == record.data["commit_sha"] && manifest["configuration_hash"] == record.data["configuration_hash"] && manifest["fixture_version"] == PLAN["fixture_version"] && manifest["fixed_clock"] == PLAN["fixed_clock"]
      scene = PLAN.fetch("review_scenarios").find { |candidate| candidate["id"] == manifest["scenario_id"] }
      raise "Unexpected tip review scenario/locale" unless scene && scene["device_id"] == manifest["device_id"] && scene["storefront_locale"] == manifest["storefront_locale"] && scene["app_locale"] == manifest["app_locale"]
      display = PLAN.fetch("devices").find { |candidate| candidate["id"] == scene["device_id"] }
      raise "Tip review runtime or appearance changed" unless manifest["runtime"] == PLAN["runtime"] && manifest["runtime_build"] == PLAN["runtime_build"] && manifest["appearance"] == PLAN["appearance"]
      file = File.expand_path(manifest.fetch("raw_path"), output)
      raise "Invalid tip review image path" unless file.start_with?(File.join(output, "review") + "/")
      raise "Tip review image bytes/dimensions changed" unless FoldingRelease.sha(file) == manifest["raw_sha256"] && png_size(file) == display.values_at("pixel_width", "pixel_height") && manifest.values_at("pixel_width", "pixel_height") == display.values_at("pixel_width", "pixel_height")
      map_path = File.join(output, "tip-review-screenshots.json")
      raise "Tip review map changed" unless FoldingRelease.sha(map_path) == manifest["map_sha256"]
      map = FoldingRelease.read_json(map_path)
      expected = CONFIG.fetch("tip_product_ids")
      raise "Tip review product mapping incomplete" unless map.keys.sort == expected.sort && manifest.fetch("product_ids").sort == expected.sort && map.values.all? { |path| path == manifest.fetch("raw_path") }
      raise "Tip product source changed since capture" unless manifest["product_source_sha256"] == FoldingRelease.sha(File.join(ROOT, "fastlane/tip-products.json"))
      map_path
    end

    def self.compose(record, raw, display, locale, scenario)
      output = File.join(record.directory, "assets")
      composed = File.join(output, "screenshots", locale.fetch("storefront_locale"), "%02d-%s-%s.png" % [scenario.fetch("order") * 2 - (display.fetch("id") == "duo-inner" ? 0 : 1), display.fetch("id"), scenario.fetch("id")])
      FileUtils.mkdir_p(File.dirname(composed))
      captions = SOURCE.fetch("locales").fetch(locale.fetch("storefront_locale")).fetch("captions")
      caption = captions.fetch(scenario.fetch("caption_key"))
      FoldingRelease.run("swift", File.join(ROOT, "fastlane/scripts/compose-screenshot.swift"), raw, composed,
        display.fetch("pixel_width").to_s, display.fetch("pixel_height").to_s, caption,
        SOURCE.fetch("locales").fetch(locale.fetch("storefront_locale")).fetch("eyebrows").fetch(scenario.fetch("caption_key")),
        scenario.fetch("appearance"), File.join(ROOT, "fastlane/screenshot-frame.json"))
      {"commit_sha" => record.data.fetch("commit_sha"), "configuration_hash" => record.data.fetch("configuration_hash"),
        "fixture_version" => PLAN.fetch("fixture_version"), "fixed_clock" => PLAN.fetch("fixed_clock"),
        "app_locale" => locale.fetch("app_locale"), "storefront_locale" => locale.fetch("storefront_locale"),
        "device_id" => display.fetch("id"), "device_model" => display.fetch("model"),
        "runtime" => PLAN.fetch("runtime"), "runtime_build" => PLAN.fetch("runtime_build"),
        "pixel_width" => display.fetch("pixel_width"), "pixel_height" => display.fetch("pixel_height"),
        "raw_pixel_size" => png_size(raw), "appearance" => scenario.fetch("appearance"), "scenario_id" => scenario.fetch("id"),
        "raw_path" => raw.delete_prefix(output + "/"), "composed_path" => composed.delete_prefix(output + "/"),
        "raw_sha256" => FoldingRelease.sha(raw), "composed_sha256" => FoldingRelease.sha(composed),
        "caption_key" => scenario.fetch("caption_key"), "caption_version" => PLAN.fetch("caption_version"),
        "caption_source_sha256" => FoldingRelease.sha(File.join(ROOT, "fastlane/metadata-source.json")),
        "plan_sha256" => FoldingRelease.sha(File.join(ROOT, "fastlane/screenshot-plan.json")),
        "frame_sha256" => FoldingRelease.sha(File.join(ROOT, "fastlane/screenshot-frame.json")),
        "compositor_sha256" => FoldingRelease.sha(File.join(ROOT, "fastlane/scripts/compose-screenshot.swift")),
        "upload_display_type" => display.fetch("upload_display_type")}
    end

    def self.validate!(record)
      validate_tip_review!(record)
      output = File.join(record.directory, "assets")
      manifest = FoldingRelease.read_json(File.join(output, "screenshot-manifest.json"))
      raise "Screenshot identity mismatch" unless manifest["commit_sha"] == record.data["commit_sha"] && manifest["configuration_hash"] == record.data["configuration_hash"]
      expected = LOCALES.flat_map do |locale|
        PLAN.fetch("devices").flat_map { |device| PLAN.fetch("scenarios").map { |scenario| [locale.fetch("storefront_locale"), device.fetch("id"), scenario.fetch("id")] } }
      end +
        LOCALES.flat_map { |locale| PLAN.fetch("additional_upload_slots").map { |slot| [locale.fetch("storefront_locale"), slot.fetch("id"), slot.fetch("scenario_id")] } }
      entries = manifest.fetch("entries")
      actual = entries.map { |entry| entry.values_at("storefront_locale", "device_id", "scenario_id") }
      raise "Incomplete/duplicate screenshot matrix" unless actual.sort == expected.sort
      entries.each do |entry|
        %w[raw composed].each do |kind|
          path = File.expand_path(entry.fetch("#{kind}_path"), output)
          raise "Invalid screenshot path" unless path.start_with?(output + "/")
          raise "Screenshot content changed" unless FoldingRelease.sha(path) == entry.fetch("#{kind}_sha256")
        end
        raise "Screenshot copy or plan changed" unless entry["caption_source_sha256"] == FoldingRelease.sha(File.join(ROOT, "fastlane/metadata-source.json")) && entry["plan_sha256"] == FoldingRelease.sha(File.join(ROOT, "fastlane/screenshot-plan.json"))
        raise "Screenshot template changed" unless entry["frame_sha256"] == FoldingRelease.sha(File.join(ROOT, "fastlane/screenshot-frame.json")) && entry["compositor_sha256"] == FoldingRelease.sha(File.join(ROOT, "fastlane/scripts/compose-screenshot.swift"))
        require "deliver/app_screenshot"
        path = File.join(output, entry.fetch("composed_path"))
        raise "Fastlane screenshot slot mismatch" unless Deliver::AppScreenshot.calculate_display_type(path) == entry.fetch("upload_display_type")
        raise "Screenshot output dimensions changed" unless png_size(File.join(output, entry.fetch("composed_path"))) == entry.values_at("pixel_width", "pixel_height")
      end
      entries.group_by { |entry| entry.values_at("storefront_locale", "upload_display_type") }.each_value do |gallery|
        raise "Apple screenshot gallery exceeds ten images" if gallery.length > 10
      end
      record.verify_identity!
      metadata = FoldingRelease.read_json(File.join(output, "metadata-manifest.json"))
      raise "Metadata identity mismatch" unless metadata["commit_sha"] == record.data["commit_sha"] && metadata["configuration_hash"] == record.data["configuration_hash"]
      metadata.fetch("files").each do |name, hash|
        path = File.expand_path(name, File.join(output, "metadata"))
        raise "Invalid metadata path" unless path.start_with?(File.join(output, "metadata") + "/")
        raise "Metadata content changed" unless FoldingRelease.sha(path) == hash
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
      @data = {"commit_sha" => source, "configuration_hash" => FoldingRelease.configuration_hash(environment), "environment" => environment}
      @directory = File.join(ROOT, "build/store-assets", source, environment)
    end

    def verify_identity!
      raise "Capture source/configuration changed" unless data["commit_sha"] == FoldingRelease.commit && data["configuration_hash"] == FoldingRelease.configuration_hash(data.fetch("environment"))
    end
  end
end
