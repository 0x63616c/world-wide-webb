require_relative "release_manifest"
require_relative "../../../../scripts/duo-host"

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
      raise "Fixture version differs from release config" unless PLAN.fetch("fixture_version") == CONFIG.fetch("fixture_version")
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

    def self.capture(context, record, review_only: false, preview: false)
      record.verify_identity!
      FoldingRelease.clean_commit!
      raise "Preview captures require a separate preview record" if preview && record.data["purpose"] != "preview"
      output = File.join(record.directory, "assets")
      if review_only && File.exist?(File.join(output, "tip-review-manifest.json"))
        return validate_tip_review!(record)
      end
      raise "Screenshot manifest already exists; reuse verified assets" if File.exist?(File.join(output, "screenshot-manifest.json"))
      FileUtils.mkdir_p(output)
      name = "Folding Capture #{SecureRandom.hex(6)}"
      device = FoldingRelease.run("xcrun", "simctl", "create", name, PLAN.fetch("device_type"), PLAN.fetch("runtime"))
      entries = []
      controller = nil
      begin
        puts JSON.generate({"event" => "storefront_capture", "stage" => "booting_device", "device_name" => name})
        FoldingRelease.run("xcrun", "simctl", "boot", device)
        FoldingRelease.run("xcrun", "simctl", "bootstatus", device, "-b")
        puts JSON.generate({"event" => "storefront_capture", "stage" => "device_booted", "device_name" => name})
        FoldingRelease.run("xcrun", "simctl", "ui", device, "appearance", PLAN.fetch("appearance"))
        FoldingRelease.run("xcrun", "simctl", "status_bar", device, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100")
        controller = DuoHost.new(directory: File.join(output, "native-control"), device_name: name).start if ENV["DUO_HOST_CONTROL"] == "1"
        PLAN.fetch("devices").reverse_each do |display|
          next if (review_only || preview) && display.fetch("id") != "duo-outer"
          request_native_pose(output, device, name, display, controller: controller)
          LOCALES.each do |locale|
            next if (review_only || preview) && locale.fetch("storefront_locale") != "en-US"
            export = File.join(output, "raw", display.fetch("id"), locale.fetch("storefront_locale"))
            result = File.join(output, "results", "#{display.fetch('id')}-#{locale.fetch('storefront_locale')}.xcresult")
            tests = review_only ? [] : ["#{PLAN.fetch('test_target')}/StorefrontRenderTests/#{display.fetch('id') == 'duo-outer' ? 'testRenderOuter' : 'testRenderInner'}"]
            if !preview && locale.fetch("storefront_locale") == "en-US" && display.fetch("id") == "duo-outer"
              tests << "#{PLAN.fetch('test_target')}/StorefrontRenderTests/testRenderTipReview"
            end
            # Execute actual UIKit views in XCTest, without launching/navigating simulator UI.
            context.run_tests(
              project: File.join(ROOT, "apps/ios/Folding.xcodeproj"), scheme: PLAN.fetch("scheme"),
              configuration: PLAN.fetch("configuration"), destination: "platform=iOS Simulator,id=#{device}",
              only_testing: tests, derived_data_path: File.join(ROOT, "build/screenshot-release"),
              result_bundle: true, result_bundle_path: result,
              output_directory: File.join(output, "logs", display.fetch("id"), locale.fetch("storefront_locale")),
              xcargs: "-testLanguage #{locale.fetch('app_locale')} -testRegion #{locale.fetch('test_region')}",
              parallel_testing: false, concurrent_workers: 1, skip_slack: true, xcodebuild_formatter: ""
            )
            FoldingRelease.run("xcrun", "xcresulttool", "export", "attachments", "--path", result, "--output-path", export)
            attachments = FoldingRelease.read_json(File.join(export, "manifest.json")).flat_map { |test| test.fetch("attachments") }
            find_capture = lambda do |display, scene|
              prefix = "storefront-#{locale.fetch('app_locale')}-#{display.fetch('id')}-#{scene.fetch('id')}_"
              matches = attachments.select { |item| item.fetch("suggestedHumanReadableName").start_with?(prefix) && item.fetch("exportedFileName").end_with?(".png") }
              raise "Missing/duplicate direct capture: #{prefix}" unless matches.length == 1
              path = File.join(export, matches.first.fetch("exportedFileName"))
              raise "Wrong direct capture dimensions" unless png_size(path) == display.values_at("pixel_width", "pixel_height")
              path
            end
            (review_only ? [] : PLAN.fetch("scenarios")).each do |scene|
              entries << compose(record, find_capture.call(display, scene), display, locale, scene)
            end
            (preview ? [] : PLAN.fetch("review_scenarios")).select { |scene| scene["device_id"] == display["id"] && scene["storefront_locale"] == locale["storefront_locale"] }.each do |scene|
              package_tip_review(record, find_capture.call(display, scene), display, locale, scene)
            end
          end
        end
        (review_only || preview ? [] : PLAN.fetch("additional_upload_slots")).each do |slot|
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
        if preview
          raise "Incomplete PR preview" unless entries.length == PLAN.fetch("scenarios").length && entries.all? { |entry| entry["device_id"] == "duo-outer" && entry["storefront_locale"] == "en-US" }
          FoldingRelease.atomic_json(File.join(output, "preview-manifest.json"), manifest.merge("purpose" => "preview"))
          FoldingRelease.clean_commit!
          return manifest
        end
        FoldingRelease.atomic_json(File.join(output, "screenshot-manifest.json"), manifest)
        FoldingRelease.clean_commit!
        validate!(record)
      ensure
        controller&.close
        # Only the simulator created by this invocation is ever shut down/deleted.
        system("xcrun", "simctl", "shutdown", device, out: File::NULL, err: File::NULL)
        system("xcrun", "simctl", "delete", device, out: File::NULL, err: File::NULL)
      end
    end

    # Native chrome uses the real Duo pose, not the framebuffer's power state.
    # A host controller acknowledges this request after selecting Open/Closed in Device Hub;
    # XCTest independently requires the exact resulting native window geometry.
    def self.request_native_pose(output, device, name, display, controller: nil)
      return controller.pose(display.fetch("id") == "duo-inner" ? "inner" : "outer") if controller
      directory = File.join(output, "native-control")
      identifier = SecureRandom.hex(12)
      FoldingRelease.atomic_json(File.join(directory, "request.json"), {
        "id" => identifier, "device_id" => device, "device_name" => name,
        "display" => display.fetch("id"), "control" => display.fetch("id") == "duo-inner" ? "Open" : "Closed"})
      puts "Native Duo pose required: #{display.fetch('id')} on #{name}; request #{directory}/request.json"
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 300
      loop do
        response = File.join(directory, "acknowledgment.json")
        return if File.file?(response) && FoldingRelease.read_json(response)["id"] == identifier
        raise "Native Duo pose was not acknowledged; task simulator will be cleaned up" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        sleep 0.25
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
        "capture_method" => PLAN.fetch("capture_method"), "raw_pixel_size" => png_size(raw), "appearance" => scenario.fetch("appearance"), "scenario_id" => scenario.fetch("id"),
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
    def initialize(environment: "production", purpose: "store")
      raise "Unknown capture purpose" unless %w[store preview].include?(purpose)
      source = FoldingRelease.clean_commit!
      @data = {"commit_sha" => source, "configuration_hash" => FoldingRelease.configuration_hash(environment), "environment" => environment, "purpose" => purpose}
      @directory = File.join(ROOT, purpose == "preview" ? "build/preview-assets" : "build/store-assets", source, environment)
    end

    def verify_identity!
      raise "Capture source/configuration changed" unless data["commit_sha"] == FoldingRelease.commit && data["configuration_hash"] == FoldingRelease.configuration_hash(data.fetch("environment"))
    end
  end
end
