require "minitest/autorun"
require_relative "../lib/storefront_readback"

class StorefrontReadbackTest < Minitest::Test
  Shot =
    Struct.new(:source_file_checksum, :file_size, :image_asset, :state) do
      def complete?
        state == "COMPLETE"
      end
    end

  def test_full_listing_readback_checks_app_info_categories_and_update_notes
    Dir.mktmpdir do |directory|
      metadata = File.join(directory, "assets/metadata/en-US")
      FileUtils.mkdir_p(metadata)
      fields = %w[
        name
        subtitle
        privacy_url
        description
        keywords
        marketing_url
        promotional_text
        support_url
        release_notes
      ]
      fields.each do |field|
        File.write(File.join(metadata, "#{field}.txt"), field)
      end
      %w[primary_category secondary_category].each do |field|
        File.write(File.join(directory, "assets/metadata/#{field}.txt"), field)
      end
      entry = {
        "storefront_locale" => "en-US",
        "upload_display_type" => "APP_IPHONE_DUO"
      }
      FoldingRelease.atomic_json(
        File.join(directory, "assets/screenshot-manifest.json"),
        { "entries" => [entry] }
      )
      info_locale =
        Struct.new(:locale, :name, :subtitle, :privacy_policy_url).new(
          "en-US",
          "name",
          "subtitle",
          "privacy_url"
        )
      category = Struct.new(:id)
      info =
        Struct.new(
          :primary_category,
          :secondary_category,
          :localizations,
          :id,
          :state
        ).new(
          category.new("primary_category"),
          category.new("secondary_category"),
          [info_locale],
          "prepared-info",
          "PREPARE_FOR_SUBMISSION"
        )
      def info.get_app_info_localizations(**)
        localizations
      end
      app = Struct.new(:info, :versions, :id).new(info, [Object.new], "app-id")
      def app.fetch_edit_app_info(**)
        if %w[
             PREPARE_FOR_SUBMISSION
             DEVELOPER_REJECTED
             REJECTED
             WAITING_FOR_REVIEW
           ].include?(info.state)
          info
        end
      end
      def app.get_app_store_versions(**)
        versions
      end
      localization =
        Struct.new(
          :locale,
          :description,
          :keywords,
          :marketing_url,
          :promotional_text,
          :support_url,
          :whats_new
        ).new(
          "en-US",
          "description",
          "keywords",
          "marketing_url",
          "promotional_text",
          "support_url",
          nil
        )
      def localization.get_app_screenshot_sets(**)
        [
          Struct.new(:screenshot_display_type, :app_screenshots).new(
            "APP_IPHONE_DUO",
            []
          )
        ]
      end
      selected =
        Struct.new(:localizations, :app_store_state).new(
          [localization],
          "PREPARE_FOR_SUBMISSION"
        )
      def selected.get_app_store_version_localizations(**)
        localizations
      end
      record = Struct.new(:directory, :data).new(directory, {})
      def record.save(changes)
        data.merge!(changes)
      end
      response = Struct.new(:to_models).new([info])
      client = Struct.new(:response).new(response)
      def client.get_app_infos(**)
        response
      end
      check = -> do
        FoldingRelease::StorefrontReadback.verify!(
          record,
          selected,
          client: client
        )
      end
      FoldingRelease.stub(:app, app) do
        FoldingRelease::StorefrontReadback.stub(:verify_gallery!, nil) do
          check.call
          assert_equal "not_applicable_first_version",
                       record
                         .data
                         .fetch("storefront_readback")
                         .fetch("release_notes")
          info_locale.name = "wrong"
          assert_raises(RuntimeError, &check)
          info_locale.name = "name"
          info.primary_category.id = "wrong"
          assert_raises(RuntimeError, &check)
          info.primary_category.id = "primary_category"
          app.versions << Object.new
          assert_raises(RuntimeError, &check)
          localization.whats_new = "release_notes"
          check.call
          assert_equal "verified",
                       record
                         .data
                         .fetch("storefront_readback")
                         .fetch("release_notes")
          # The SDK's editable-info helper excludes the prepared review state.
          info.state = selected.app_store_state = "READY_FOR_REVIEW"
          assert_nil app.fetch_edit_app_info
          check.call
          assert_equal "prepared-info",
                       record
                         .data
                         .fetch("storefront_readback")
                         .fetch("app_info_id")
          live = info.dup
          live.id = "published-info"
          live.state = "READY_FOR_DISTRIBUTION"
          client.response.to_models.unshift(live)
          check.call
          client.response.to_models.delete(info)
          assert_raises(RuntimeError, &check)
          record.data.delete("storefront_readback")
          duplicate = info.dup
          duplicate.id = "other-prepared-info"
          client.response.to_models.concat([info, duplicate])
          assert_raises(RuntimeError, &check)
        end
      end
    end
  end

  def test_gallery_requires_complete_exact_ordered_bytes_and_dimensions
    Dir.mktmpdir do |directory|
      entries =
        2.times.map do |i|
          file = "#{i}.png"
          File.write(File.join(directory, file), "image #{i}")
          {
            "composed_path" => file,
            "pixel_width" => i == 0 ? 1398 : 2007,
            "pixel_height" => i == 0 ? 2034 : 2853
          }
        end
      shots =
        entries.map do |entry|
          path = File.join(directory, entry["composed_path"])
          Shot.new(
            Digest::MD5.file(path).hexdigest,
            File.size(path),
            {
              "width" => entry["pixel_width"],
              "height" => entry["pixel_height"]
            },
            "COMPLETE"
          )
        end
      check = -> do
        FoldingRelease::StorefrontReadback.verify_gallery!(
          shots,
          entries,
          directory
        )
      end
      check.call
      shots.reverse!
      assert_raises(RuntimeError, &check)
      shots.reverse!
      shots.first.state = "PROCESSING"
      assert_raises(RuntimeError, &check)
      shots.first.state = "COMPLETE"
      shots.first.image_asset["width"] = 1
      assert_raises(RuntimeError, &check)
      shots.first.image_asset["width"] = 1398
      File.write(File.join(directory, "0.png"), "changed")
      assert_raises(RuntimeError, &check)
      shots.pop
      assert_raises(RuntimeError, &check)
    end
  end
end
