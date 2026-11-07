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

    def self.capture(context, record)
      record.verify_identity!
      FoldingRelease.clean_commit!
      output = File.join(record.directory, "assets")
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
          PLAN.fetch("devices").each do |screen|
            FoldingRelease.run("xcrun", "simctl", "io", device, "screenConfig", "--display=#{screen.fetch('screen')}", "power", screen == display ? "on" : "off")
          end
          LOCALES.each do |locale|
            raw_dir = File.join(output, "raw", display.fetch("id"), locale.fetch("storefront_locale"))
            context.capture_screenshots(
              project: File.join(ROOT, "apps/ios/Folding.xcodeproj"), scheme: PLAN.fetch("scheme"),
              configuration: PLAN.fetch("configuration"), devices: [name],
              languages: [locale.fetch("snapshot_locale")],
              launch_arguments: ["--folding-screenshot-locale #{locale.fetch('app_locale')} --folding-screenshot-appearance #{PLAN.fetch('appearance')}"],
              only_testing: PLAN.fetch("scenarios").map { |scenario| "#{PLAN.fetch('test_target')}/FoldingScreenshotTests/#{scenario.fetch('test')}" },
              output_directory: raw_dir, derived_data_path: File.join(ROOT, "build/screenshot-release"),
              clear_previous_screenshots: true, reinstall_app: true,
              concurrent_simulators: false, number_of_retries: 0, skip_open_summary: true,
              override_status_bar: false, xcodebuild_formatter: ""
            )
            PLAN.fetch("scenarios").each do |scenario|
              matches = Dir.glob(File.join(raw_dir, "**/*#{scenario.fetch('id')}.png"))
              raise "Missing/duplicate current capture" unless matches.length == 1
              raw = matches.first
              raise "Wrong Duo display captured" unless png_size(raw) == [display.fetch("pixel_width"), display.fetch("pixel_height")]
              entries << compose(record, raw, display, locale, scenario)
            end
          end
        end
        PLAN.fetch("additional_upload_slots").each do |slot|
          LOCALES.each do |locale|
            source = entries.find { |entry| entry["device_id"] == slot.fetch("source_device_id") && entry["scenario_id"] == slot.fetch("scenario_id") && entry["storefront_locale"] == locale.fetch("storefront_locale") }
            scenario = PLAN.fetch("scenarios").find { |item| item["id"] == slot.fetch("scenario_id") }
            display = slot.merge("model" => "Duo capture in App Store medium canvas")
            entries << compose(record, File.join(output, source.fetch("raw_path")), display, locale, scenario)
          end
        end
        manifest = {"schema_version" => 1, "commit_sha" => record.data.fetch("commit_sha"),
          "configuration_hash" => record.data.fetch("configuration_hash"), "entries" => entries}
        FoldingRelease.atomic_json(File.join(output, "screenshot-manifest.json"), manifest)
        validate!(record)
      ensure
        # Only the simulator created by this invocation is ever shut down/deleted.
        system("xcrun", "simctl", "shutdown", device, out: File::NULL, err: File::NULL)
        system("xcrun", "simctl", "delete", device, out: File::NULL, err: File::NULL)
      end
    end

    def self.compose(record, raw, display, locale, scenario)
      output = File.join(record.directory, "assets")
      composed = File.join(output, "screenshots", locale.fetch("storefront_locale"), "#{display.fetch('id')}-#{scenario.fetch('id')}.png")
      FileUtils.mkdir_p(File.dirname(composed))
      captions = SOURCE.fetch("locales").fetch(locale.fetch("storefront_locale")).fetch("captions")
      caption = captions.fetch(scenario.fetch("caption_key"))
      FoldingRelease.run("swift", File.join(ROOT, "fastlane/scripts/compose-screenshot.swift"), raw, composed,
        display.fetch("pixel_width").to_s, display.fetch("pixel_height").to_s, caption)
      {"commit_sha" => record.data.fetch("commit_sha"), "configuration_hash" => record.data.fetch("configuration_hash"),
        "fixture_version" => PLAN.fetch("fixture_version"), "fixed_clock" => PLAN.fetch("fixed_clock"),
        "app_locale" => locale.fetch("app_locale"), "storefront_locale" => locale.fetch("storefront_locale"),
        "device_id" => display.fetch("id"), "device_model" => display.fetch("model"),
        "runtime" => PLAN.fetch("runtime"), "runtime_build" => PLAN.fetch("runtime_build"),
        "pixel_width" => display.fetch("pixel_width"), "pixel_height" => display.fetch("pixel_height"),
        "raw_pixel_size" => png_size(raw), "appearance" => PLAN.fetch("appearance"), "scenario_id" => scenario.fetch("id"),
        "raw_path" => raw.delete_prefix(output + "/"), "composed_path" => composed.delete_prefix(output + "/"),
        "raw_sha256" => FoldingRelease.sha(raw), "composed_sha256" => FoldingRelease.sha(composed),
        "caption_key" => scenario.fetch("caption_key"), "caption_version" => PLAN.fetch("caption_version"),
        "upload_display_type" => display.fetch("upload_display_type")}
    end

    def self.validate!(record)
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
        raise "Screenshot output dimensions changed" unless png_size(File.join(output, entry.fetch("composed_path"))) == entry.values_at("pixel_width", "pixel_height")
      end
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
