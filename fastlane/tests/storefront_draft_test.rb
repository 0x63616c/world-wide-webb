require "minitest/autorun"
require_relative "../lib/storefront_draft"

class StorefrontDraftTest < Minitest::Test
  def test_draft_upload_cannot_submit_select_or_upload_a_build
    record = Struct.new(:data, :directory).new({"bundle_id" => "app", "asc_app_id" => "id"}, "/draft")
    def record.save(values); data.merge!(values); end
    version = Struct.new(:version_string, :app_store_state, :id).new("1.0", "PREPARE_FOR_SUBMISSION", "draft")
    app = Struct.new(:versions).new([version])
    def app.get_app_store_versions(**); versions; end
    def app.get_edit_app_store_version(**); versions.first; end
    context = Object.new
    def context.upload_to_app_store(**options); @options = options; end
    def context.options; @options; end
    FoldingRelease::StorefrontDraft::Record.stub(:new, record) do
      FoldingRelease::Assets.stub(:validate!, true) do
        FoldingRelease.stub(:app, app) do
          FoldingRelease.stub(:client, Object.new) do
            FoldingRelease.stub(:api_key, {}) do
              FoldingRelease::StorefrontReadback.stub(:verify!, true) do
                FoldingRelease::StorefrontDraft.upload(context, version: "1.0")
                assert_equal false, context.options.fetch(:submit_for_review)
                assert context.options.fetch(:skip_binary_upload)
                assert context.options.fetch(:skip_app_version_update)
                refute context.options.key?(:build_number)
                refute context.options.key?(:ipa)
                assert_equal "draft_listing_verified", record.data.fetch("state")
                assert_equal false, record.data.fetch("submission_performed")
                version.app_store_state = "WAITING_FOR_REVIEW"
                assert_raises(RuntimeError) { FoldingRelease::StorefrontDraft.upload(context, version: "1.0") }
                app.versions = []
                assert_raises(RuntimeError) { FoldingRelease::StorefrontDraft.upload(context, version: "1.0") }
              end
            end
          end
        end
      end
    end
  end
end
