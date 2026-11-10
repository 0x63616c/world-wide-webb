require "digest/md5"
require_relative "release_assets"

module FoldingRelease
  module StorefrontReadback
    # Compare Apple's ordered gallery to the exact sealed bytes, including the shared Duo slot.
    def self.verify!(record, selected, client: FoldingRelease.client)
      output = File.join(record.directory, "assets")
      copyright = File.join(output, "metadata/copyright.txt")
      raise "Apple copyright differs" if File.file?(copyright) && selected.copyright.to_s.strip != File.read(copyright).strip
      entries = FoldingRelease.read_json(File.join(output, "screenshot-manifest.json")).fetch("entries")
      app = FoldingRelease.app(record.data)
      infos = client.get_app_infos(app_id: app.id, includes: "primaryCategory,secondaryCategory").to_models
      previous_id = record.data.dig("storefront_readback", "app_info_id")
      # Preparing the review bundle changes the same information to
      # READY_FOR_REVIEW, which the SDK's editable-info helper excludes.
      matching = infos.select do |item|
        previous_id ? item.id == previous_id : item.state == selected.app_store_state
      end
      raise "Apple app information is missing or ambiguous" unless matching.one?
      info = matching.first
      %w[primary_category secondary_category].each do |field|
        expected = File.read(File.join(output, "metadata", "#{field}.txt")).strip
        raise "Apple category differs: #{field}" unless info.public_send(field)&.id == expected
      end
      app_localizations = info.get_app_info_localizations(client: client)
      first_version = app.get_app_store_versions(client: client, filter: {platform: "IOS"}, limit: 2).length == 1
      localizations = selected.get_app_store_version_localizations(client: client)
      result = entries.group_by { |entry| entry.fetch("storefront_locale") }.map do |locale, images|
        matches = localizations.select { |localization| localization.locale == locale }
        raise "Missing/duplicate Apple storefront locale: #{locale}" unless matches.length == 1
        localization = matches.first
        %w[description keywords marketing_url promotional_text support_url].each do |field|
          expected = File.read(File.join(output, "metadata", locale, "#{field}.txt")).strip
          raise "Apple listing differs: #{locale}/#{field}" unless localization.public_send(field).to_s.strip == expected
        end
        unless first_version
          expected = File.read(File.join(output, "metadata", locale, "release_notes.txt")).strip
          raise "Apple release notes differ: #{locale}" unless localization.whats_new.to_s.strip == expected
        end
        app_matches = app_localizations.select { |item| item.locale == locale }
        raise "Missing/duplicate Apple app-info locale: #{locale}" unless app_matches.length == 1
        {"name" => "name", "subtitle" => "subtitle", "privacy_url" => "privacy_policy_url"}.each do |field, attribute|
          expected = File.read(File.join(output, "metadata", locale, "#{field}.txt")).strip
          raise "Apple app information differs: #{locale}/#{field}" unless app_matches.first.public_send(attribute).to_s.strip == expected
        end
        sets = localization.get_app_screenshot_sets(client: client)
        galleries = images.group_by { |entry| entry.fetch("upload_display_type") }.map do |type, gallery|
          found = sets.select { |set| set.screenshot_display_type == type }
          raise "Missing/duplicate Apple screenshot slot: #{locale}/#{type}" unless found.length == 1
          verify_gallery!(found.first.app_screenshots || [], gallery, output)
          {"display_type" => type, "count" => gallery.length}
        end
        {"locale" => locale, "galleries" => galleries}
      end
      record.save("storefront_readback" => {"verified_at" => Time.now.utc.iso8601, "app_info_id" => info.id, "app_info_state" => info.state,
        "localizations" => result, "release_notes" => first_version ? "not_applicable_first_version" : "verified"})
    end

    def self.verify_gallery!(screenshots, gallery, output)
      ordered = gallery.sort_by { |entry| File.basename(entry.fetch("composed_path")) }
      raise "Apple screenshot count differs" unless screenshots.length == ordered.length
      screenshots.zip(ordered).each do |screenshot, entry|
        file = File.join(output, entry.fetch("composed_path"))
        raise "Apple screenshot processing pending or failed; resume storefront readback" unless screenshot.complete?
        raise "Apple screenshot bytes/order differ" unless screenshot.source_file_checksum.to_s.downcase == Digest::MD5.file(file).hexdigest && screenshot.file_size == File.size(file)
        raise "Apple screenshot dimensions differ" unless screenshot.image_asset&.values_at("width", "height") == entry.values_at("pixel_width", "pixel_height")
      end
    end
  end
end
