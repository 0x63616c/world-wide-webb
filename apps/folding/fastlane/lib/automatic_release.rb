require_relative "release_operations"
require_relative "tip_products"
require_relative "../../../../scripts/pending-release"
require_relative "../../../../scripts/release-source"
require "yaml"

module FoldingRelease
  # Folding keeps its immutable archive/receipt owner; the version/review decisions
  # are shared with Tendr. A waiting review is withdrawn only after its replacement
  # build and sealed screenshots are ready. An in-review bundle is never withdrawn.
  module AutomaticRelease
    def self.configured_version
      value = YAML.safe_load(File.read(File.join(ROOT, "app.yml")))
      value.fetch("version")
    end

    def self.planner(source)
      PendingRelease.new(FoldingRelease.client.tunes_request_client,
        FoldingAppleAccount.config.fetch("production").fetch("app_store_id"), source,
        ancestor: ReleaseSource.method(:ancestor?))
    end

    def self.plan
      source = FoldingRelease.clean_commit!
      configured = configured_version
      ReleaseSource.current!("folding", source)
      asc = FoldingRelease.client.tunes_request_client
      app_id = FoldingAppleAccount.config.fetch("production").fetch("app_store_id")
      rows = ReleasePipeline.all(asc, "v1/apps/#{app_id}/appStoreVersions?filter[platform]=IOS&limit=50")
      target, id = planner(source).plan(rows, configured)
      raise "Tagged version must match the processed beta; bump app.yml before building a new version" unless target == configured
      unless id
        asc.post("v1/appStoreVersions", {data: {type: "appStoreVersions",
          attributes: {platform: "IOS", versionString: target, releaseType: "AFTER_APPROVAL"},
          relationships: {app: {data: {type: "apps", id: app_id}}}}})
      end
      target
    end

    def self.promote(context, receipt)
      source = FoldingRelease.clean_commit!
      raise "Beta receipt belongs to another app/source" unless receipt.values_at("app", "sha") == ["folding", source]
      record = FoldingRelease::Record.new(receipt.fetch("release_tag"))
      raise "Beta receipt differs from the immutable release" unless record.data.values_at("commit_sha", "marketing_version") == [source, receipt.fetch("version")] &&
        record.data.fetch("build_number").to_s == receipt.fetch("build").to_s
      Operations.verify_processed!(record)
      begin
        version = plan
        raise "Planned version differs from the tested beta" unless version == receipt.fetch("version")
      rescue ReleasePipeline::AlreadySubmitted
        raise "Apple submission could not be reconciled" unless Operations.observe_submission(record)
        return record
      end
      finish(context, record)
      record
    end

    def self.mark_source(record)
      asc = FoldingRelease.client.test_flight_request_client
      id = record.data.fetch("asc_build_id")
      marker = "Build from main (#{record.data.fetch('commit_sha')})"
      rows = ReleasePipeline.all(asc, "v1/builds/#{id}/betaBuildLocalizations?limit=200")
      english = rows.select { |row| row.dig("attributes", "locale") == "en-US" }
      raise "Ambiguous build source localization" if english.length > 1
      if english.empty?
        FoldingRelease.client.post_beta_build_localizations(build_id: id, attributes: {locale: "en-US", whatsNew: marker})
      elsif english.first.dig("attributes", "whatsNew") != marker
        FoldingRelease.client.patch_beta_build_localizations(localization_id: english.first.fetch("id"), attributes: {whatsNew: marker})
      end
      rows = ReleasePipeline.all(asc, "v1/builds/#{id}/betaBuildLocalizations?limit=200")
      raise "Build ownership marker not confirmed" unless rows.any? { |row| row.dig("attributes", "locale") == "en-US" && row.dig("attributes", "whatsNew") == marker }
    end

    def self.ensure_app_configuration(record, api: FoldingTipProducts::API.new)
      id = record.data.fetch("asc_app_id")
      declarations = FoldingRelease.read_json(File.join(ROOT, "fastlane/apple-declarations.json"))
      rights = declarations.fetch("content_rights")
      raise "Owner content rights approval missing" unless declarations.fetch("app_id") == id && rights["necessary_rights_confirmed_by_owner"] == true
      expected = rights.fetch("contains_third_party_content") ? "USES_THIRD_PARTY_CONTENT" : "DOES_NOT_USE_THIRD_PARTY_CONTENT"
      actual = api.request("GET", "/v1/apps/#{id}").dig("data", "attributes", "contentRightsDeclaration")
      raise "Apple content rights differ from owner approval" if actual && actual != expected
      unless actual
        api.request("PATCH", "/v1/apps/#{id}", body: ReviewSubmission.resource("apps", id: id, attributes: {"contentRightsDeclaration" => expected}))
        # Apple's successful PATCH can precede its GET readback. Observe the
        # same write for at most 30 seconds; never retry the mutation here.
        7.times do |attempt|
          actual = api.request("GET", "/v1/apps/#{id}").dig("data", "attributes", "contentRightsDeclaration")
          break if actual == expected
          sleep 5 if attempt < 6
        end
        raise "Apple content rights readback differs" unless actual == expected
      end
      schedule = api.request("GET", "/v1/apps/#{id}/appPriceSchedule", missing: true)&.fetch("data")
      price_path = ->(schedule) { "/v1/appPriceSchedules/#{schedule.fetch('id')}/manualPrices?include=appPricePoint&limit=200" }
      prices = schedule && api.request("GET", price_path.call(schedule))
      # Apple returns a schedule shell even before a first price is configured.
      unless prices && !prices.fetch("data").empty?
        if schedule
          automatic = api.all("/v1/appPriceSchedules/#{schedule.fetch('id')}/automaticPrices?limit=200")
          raise "Existing automatic pricing has no base; inspect Apple pricing" unless automatic.empty?
        end
        points = api.all("/v1/apps/#{id}/appPricePoints?filter%5Bterritory%5D=USA&limit=200")
        free = points.select { |point| BigDecimal(point.fetch("attributes").fetch("customerPrice")) == 0 }
        raise "Expected one real Apple free price point" unless free.one?
        inline = "${folding-free}"
        body = ReviewSubmission.resource("appPriceSchedules", relationships: {
          "app" => ReviewSubmission.relationship("apps", id), "baseTerritory" => ReviewSubmission.relationship("territories", "USA"),
          "manualPrices" => {"data" => [{"type" => "appPrices", "id" => inline}]}})
        body["included"] = [{"type" => "appPrices", "id" => inline, "attributes" => {"startDate" => nil},
          "relationships" => {"appPricePoint" => ReviewSubmission.relationship("appPricePoints", free.first.fetch("id"))}}]
        api.request("POST", "/v1/appPriceSchedules", body: body)
        7.times do |attempt|
          schedule = api.request("GET", "/v1/apps/#{id}/appPriceSchedule").fetch("data")
          prices = schedule && api.request("GET", price_path.call(schedule))
          break if prices && !prices.fetch("data").empty?
          sleep 5 if attempt < 6
        end
      end
      raise "Apple price readback is still pending; resume to reconcile" unless prices
      points = prices.fetch("included", []).select { |row| row["type"] == "appPricePoints" }
      raise "Folding must remain free; inspect Apple pricing" unless !prices.fetch("data").empty? && !points.empty? && points.all? { |point| BigDecimal(point.fetch("attributes").fetch("customerPrice")) == 0 }
    end

    def self.preflight(record)
      record.verify_identity!
      source = FoldingRelease.clean_commit!
      raise "Release source differs" unless source == record.data.fetch("commit_sha")
      configured_version
      ReleaseSource.current!("folding", source)
      raise "Production only" unless record.data.fetch("environment") == "production"
      checks = record.data.fetch("beta_source_checks")
      %w[contracts domain-storage native-build localization].each do |name|
        selected = checks.select { |check| check["name"] == name }
        raise "Missing or ambiguous source CI check: #{name}" unless selected.one?
        CheckEvidence.validate!(selected.first, source: source, base: record.directory)
      end
      # Includes matching-input backend CI, immutable Cloudflare readback,
      # required live capabilities, enabled app features and public pages.
      worker = FoldingRelease.live_prerequisites!(record)
      %w[archive ipa dsym].each { |kind| record.artifact(kind) }
      Operations.verify_processed!(record)
      raise "Internal TestFlight assignment unverified" unless record.data["testflight_distributed_build_id"] == record.data.fetch("asc_build_id") && record.data["testflight_group_assignment_verified_at"]
      Operations.restore_assets(record)
      prs = JSON.parse(FoldingRelease.run("gh", "api", "repos/#{CONFIG.fetch('repository')}/commits/#{source}/pulls"))
        .select { |pr| pr["merged_at"] && pr["merge_commit_sha"] == source && pr.dig("base", "ref") == "main" }
      raise "Expected a reviewed main merge" unless prs.one?
      declarations = FoldingRelease.read_json(File.join(ROOT, "fastlane/apple-declarations.json"))
      raise "Owner Apple declarations incomplete" unless declarations["app_id"] == record.data.fetch("asc_app_id") &&
        declarations.dig("privacy", "state") == "published" && declarations.dig("age_rating", "state") == "saved" &&
        declarations.dig("content_rights", "necessary_rights_confirmed_by_owner") == true
      record.save("deployed_worker_version" => worker, "automatic_submission_checks_verified_at" => Time.now.utc.iso8601,
        "source_pull_request" => prs.first.fetch("html_url"),
        "device_acceptance" => {"state" => "owner_deferred_until_after_submission", "reference" => "docs/review-spec.md"})
    end

    def self.finish(context, record)
      source = record.data.fetch("commit_sha")
      ReleaseSource.current!("folding", source)
      # Stop before capture or review mutations when release prerequisites fail.
      FoldingRelease.live_prerequisites!(record)
      ensure_app_configuration(record)
      FoldingTipProducts.configure_app_availability
      mark_source(record)
      Operations.assets(context, record)
      preflight(record)
      pending = planner(source)
      required = pending.replace!(record.data.fetch("marketing_version"),
        before_cancel: -> { ReleaseSource.current!("folding", source) })
      selected = Operations.storefront(context, record)
      ReviewSubmission.prepare(record, selected.id)
      actual = ReviewSubmission.items(FoldingTipProducts::API.new, record.data.fetch("prepared_submission_id"))
        .map { |item| ReviewSubmission.identity(item) }
      retained = required.map { |relation, _, id| [relation, id] }
      raise "Replacement lost review items" unless (retained - actual).empty?
      ReleaseSource.current!("folding", source)
      Operations.submit(context, record)
    end
  end
end
