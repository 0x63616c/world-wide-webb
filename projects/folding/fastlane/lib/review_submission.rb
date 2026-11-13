# App Store Connect review resources include the app and its three tip versions in
# one submission. Every retry reads relationships before creating another item.
module FoldingRelease
  module ReviewSubmission
    def self.relationship(type, id)
      { "data" => { "type" => type, "id" => id } }
    end

    def self.resource(type, relationships: {}, attributes: {}, id: nil)
      data = {
        "type" => type,
        "relationships" => relationships,
        "attributes" => attributes
      }
      data["id"] = id if id
      { "data" => data }
    end

    def self.items(api, submission_id)
      api.all(
        "/v1/reviewSubmissions/#{submission_id}/items?include=appStoreVersion,inAppPurchaseVersion"
      )
    end

    def self.identity(item)
      relationships = item.fetch("relationships")
      pairs =
        relationships.filter_map do |name, value|
          data = value["data"]
          [name, data.fetch("id")] if data.is_a?(Hash)
        end
      supported =
        pairs.select do |name, _|
          %w[appStoreVersion inAppPurchaseVersion].include?(name)
        end
      raise "Unexpected review item" unless supported.length == 1
      supported.first
    end

    def self.prepare(record, version_id, api: FoldingTipProducts::API.new)
      app_id = record.data.fetch("asc_app_id")
      products = api.all("/v1/apps/#{app_id}/inAppPurchasesV2?limit=200")
      selected =
        CONFIG
          .fetch("tip_product_ids")
          .map do |product_id|
            matches =
              products.select do |product|
                product.dig("attributes", "productId") == product_id
              end
            unless matches.length == 1
              raise "Missing or ambiguous tip #{product_id}"
            end
            product = matches.first
            unless %w[
                     READY_TO_SUBMIT
                     WAITING_FOR_REVIEW
                     IN_REVIEW
                     APPROVED
                   ].include?(product.dig("attributes", "state"))
              raise "Tip not ready for review"
            end
            next if product.dig("attributes", "state") == "APPROVED"
            versions =
              api.all("/v2/inAppPurchases/#{product.fetch("id")}/versions")
            # Draft versions become READY_FOR_REVIEW only after attachment to a
            # review submission. Existing and newly created drafts start editable.
            review_states = %w[
              PREPARE_FOR_SUBMISSION
              READY_FOR_REVIEW
              WAITING_FOR_REVIEW
              IN_REVIEW
            ]
            eligible =
              versions.select do |v|
                review_states.include?(v.dig("attributes", "state"))
              end
            if eligible.empty? && versions.empty?
              api.request(
                "POST",
                "/v1/inAppPurchaseVersions",
                body:
                  resource(
                    "inAppPurchaseVersions",
                    relationships: {
                      "inAppPurchase" =>
                        relationship("inAppPurchases", product.fetch("id"))
                    }
                  )
              )
              eligible =
                api
                  .all("/v2/inAppPurchases/#{product.fetch("id")}/versions")
                  .select do |v|
                    review_states.include?(v.dig("attributes", "state"))
                  end
            end
            unless eligible.length == 1
              raise "Tip version is not uniquely ready; reconcile Apple metadata"
            end
            {
              "product_id" => product_id,
              "id" => product.fetch("id"),
              "version_id" => eligible.first.fetch("id")
            }
          end
          .compact
      expected =
        [["appStoreVersion", version_id]] +
          selected.map { |p| ["inAppPurchaseVersion", p.fetch("version_id")] }
      if (id = record.data["prepared_submission_id"])
        submission =
          api.request("GET", "/v1/reviewSubmissions/#{id}").fetch("data")
      else
        submissions =
          api.all(
            "/v1/reviewSubmissions?filter%5Bapp%5D=#{app_id}&filter%5Bplatform%5D=IOS&filter%5Bstate%5D=READY_FOR_REVIEW"
          )
        if submissions.length > 1
          raise "Multiple draft submissions; reconcile Apple"
        end
        submission =
          submissions.first ||
            api.request(
              "POST",
              "/v1/reviewSubmissions",
              body:
                resource(
                  "reviewSubmissions",
                  attributes: {
                    "platform" => "IOS"
                  },
                  relationships: {
                    "app" => relationship("apps", app_id)
                  }
                )
            ).fetch("data")
        id = submission.fetch("id")
      end
      unless submission.dig("attributes", "state") == "READY_FOR_REVIEW"
        raise "Submission is no longer editable"
      end
      present = items(api, id).map { |item| identity(item) }
      unless (present - expected).empty? && present.uniq == present
        raise "Draft contains unrelated or duplicate review items"
      end
      record.save(
        "prepared_submission_id" => id,
        "submission_tip_versions" => selected,
        "submission_app_version_id" => version_id
      )
      (expected - present).each do |name, item_id|
        type =
          (
            if name == "appStoreVersion"
              "appStoreVersions"
            else
              "inAppPurchaseVersions"
            end
          )
        api.request(
          "POST",
          "/v1/reviewSubmissionItems",
          body:
            resource(
              "reviewSubmissionItems",
              relationships: {
                "reviewSubmission" => relationship("reviewSubmissions", id),
                name => relationship(type, item_id)
              }
            )
        )
      end
      verify_items!(record, api: api)
      id
    end

    def self.verify_items!(record, api: FoldingTipProducts::API.new)
      expected =
        [["appStoreVersion", record.data.fetch("submission_app_version_id")]] +
          record
            .data
            .fetch("submission_tip_versions")
            .map do |product|
              ["inAppPurchaseVersion", product.fetch("version_id")]
            end
      actual =
        items(api, record.data.fetch("prepared_submission_id")).map do |item|
          identity(item)
        end
      unless actual.sort == expected.sort
        raise "Apple review items differ from the app and three tips"
      end
      record
        .data
        .fetch("submission_tip_versions")
        .each do |product|
          version =
            api.request(
              "GET",
              "/v1/inAppPurchaseVersions/#{product.fetch("version_id")}?include=inAppPurchase"
            ).fetch("data")
          owner = version.dig("relationships", "inAppPurchase", "data", "id")
          unless owner == product.fetch("id")
            raise "Tip review version belongs to a different product"
          end
        end
    end

    def self.submit(record, api: FoldingTipProducts::API.new)
      verify_items!(record, api: api)
      id = record.data.fetch("prepared_submission_id")
      api.request(
        "PATCH",
        "/v1/reviewSubmissions/#{id}",
        body:
          resource(
            "reviewSubmissions",
            id: id,
            attributes: {
              "submitted" => true
            }
          )
      )
    end
  end
end
