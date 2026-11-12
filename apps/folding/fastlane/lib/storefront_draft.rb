require_relative "storefront_readback"

module FoldingRelease
  # Reversible draft listing preparation. It does not select/upload a binary or submit a review.
  module StorefrontDraft
    class Record < LocalCaptureRecord
      def initialize
        super(environment: "production")
        identity = FoldingAppleAccount.config.fetch("production")
        data.merge!(
          "bundle_id" => identity.fetch("bundle_id"),
          "asc_app_id" => identity.fetch("app_store_id")
        )
      end

      def save(values)
        data.merge!(values)
        FoldingRelease.atomic_json(
          File.join(directory, "draft-listing-readback.json"),
          data
        )
      end
    end

    def self.upload(context, version:)
      record = Record.new
      Assets.validate!(record)
      app = FoldingRelease.app(record.data)
      versions =
        app
          .get_app_store_versions(
            client: FoldingRelease.client,
            filter: {
              platform: "IOS"
            }
          )
          .select { |item| item.version_string == version }
      unless versions.length == 1 &&
               versions.first.app_store_state == "PREPARE_FOR_SUBMISSION"
        raise "Expected one existing editable version"
      end
      editable =
        app.get_edit_app_store_version(
          client: FoldingRelease.client,
          platform: "IOS"
        )
      unless editable&.id == versions.first.id
        raise "Apple editable version differs from requested draft"
      end
      context.upload_to_app_store(
        api_key: FoldingRelease.api_key,
        app_identifier: record.data.fetch("bundle_id"),
        app_version: version,
        skip_app_version_update: true,
        skip_binary_upload: true,
        metadata_path: File.join(record.directory, "assets/metadata"),
        screenshots_path: File.join(record.directory, "assets/screenshots"),
        overwrite_screenshots: true,
        force: true,
        submit_for_review: false,
        run_precheck_before_submit: false
      )
      selected =
        app.get_edit_app_store_version(
          client: FoldingRelease.client,
          platform: "IOS"
        )
      unless selected&.id == versions.first.id
        raise "Editable draft changed during upload"
      end
      StorefrontReadback.verify!(record, selected)
      record.save(
        "state" => "draft_listing_verified",
        "app_store_version" => version,
        "final_release_acceptance" => "pending",
        "submission_performed" => false
      )
    end
  end
end
