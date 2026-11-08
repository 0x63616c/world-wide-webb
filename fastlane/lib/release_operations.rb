require_relative "review_submission"
require "shellwords"
require_relative "release_assets"
require_relative "storefront_readback"

module FoldingRelease
  module Operations
    def self.require_state!(record, state)
      raise "Expected #{state}; found #{record.data.fetch('state')}" unless record.data.fetch("state") == state
      record.verify_identity!
    end

    def self.preflight(record, evidence_path, final: false)
      record.verify_identity!
      FoldingRelease.clean_commit!
      evidence = FoldingRelease.check_evidence!(record, evidence_path, final: final)
      worker = FoldingRelease.live_prerequisites!(record)
      if final
        raise "Production only" unless record.data["environment"] == "production"
        assets = restore_assets(record)
        raise "Copyright owner must be supplied before assets are sealed" unless File.file?(File.join(assets, "metadata/copyright.txt")) && !File.read(File.join(assets, "metadata/copyright.txt")).strip.empty?
        %w[archive ipa dsym].each { |kind| record.artifact(kind) }
        verify_processed!(record)
        required = CONFIG.fetch("tip_product_ids")
        products = evidence.fetch("products")
        raise "Required tip products not confirmed ready" unless required.all? { |identifier| products.any? { |product| product["product_id"] == identifier && %w[READY_TO_SUBMIT WAITING_FOR_REVIEW IN_REVIEW APPROVED].include?(product["state"]) } }
        raise "Metadata/localization review unfinished" unless evidence["metadata_reviewed"] == true && evidence["screenshots_reviewed"] == true
        raise "App privacy and age rating incomplete" unless evidence["app_privacy_complete"] == true && evidence["age_rating_complete"] == true
      end
      changes = {"required_checks" => evidence.fetch("required_checks"), "deployed_worker_version" => worker,
        "preflight_evidence_sha256" => FoldingRelease.sha(evidence_path)}
      if record.data["state"] == "planned"
        record.advance("validated", changes)
      else
        record.save(changes)
      end
    end

    def self.assets(context, record)
      require_state!(record, "validated")
      directory = File.join(record.directory, "assets")
      Assets.metadata(record) unless File.exist?(File.join(record.directory, "assets/metadata-manifest.json"))
      Assets.capture(context, record) unless File.exist?(File.join(record.directory, "assets/screenshot-manifest.json"))
      Assets.validate!(record)
      manifest_hashes = {
        "screenshot_manifest_sha256" => FoldingRelease.sha(File.join(directory, "screenshot-manifest.json")),
        "tip_review_manifest_sha256" => FoldingRelease.sha(File.join(directory, "tip-review-manifest.json")),
        "tip_review_map_sha256" => FoldingRelease.sha(File.join(directory, "tip-review-screenshots.json")),
        "metadata_manifest_sha256" => FoldingRelease.sha(File.join(directory, "metadata-manifest.json"))
      }
      bundle = File.join(record.directory, "assets.zip")
      raise "Copyright owner is required before sealing assets" unless File.file?(File.join(directory, "metadata/copyright.txt"))
      if File.exist?(bundle)
        raise "Unrecorded assets bundle; inspect before retry" unless record.data["assets_candidate_sha256"] == FoldingRelease.sha(bundle)
        raise "Assets changed since bundle creation; inspect before retry" unless record.data["assets_candidate_manifests"] == manifest_hashes
      else
        FoldingRelease.run("ditto", "-c", "-k", "--keepParent", directory, bundle)
        record.save("assets_candidate_sha256" => FoldingRelease.sha(bundle), "assets_candidate_manifests" => manifest_hashes)
      end
      record.remote.upload_artifact(bundle)
      record.advance("assets_ready", manifest_hashes.merge("assets_sha256" => FoldingRelease.sha(bundle),
        "artifacts" => record.data.fetch("artifacts").merge("assets" => File.basename(bundle))))
    end

    def self.restore_assets(record)
      bundle = record.artifact("assets")
      directory = File.join(record.directory, "assets")
      FoldingRelease.run("ditto", "-x", "-k", bundle, record.directory) unless File.directory?(directory)
      %w[screenshot metadata].each do |kind|
        raise "Asset manifest changed" unless FoldingRelease.sha(File.join(directory, "#{kind}-manifest.json")) == record.data.fetch("#{kind}_manifest_sha256")
      end
      raise "Tip review manifest changed" unless FoldingRelease.sha(File.join(directory, "tip-review-manifest.json")) == record.data.fetch("tip_review_manifest_sha256")
      raise "Tip review map changed" unless FoldingRelease.sha(File.join(directory, "tip-review-screenshots.json")) == record.data.fetch("tip_review_map_sha256")
      Assets.validate!(record)
      directory
    end

    def self.plist(path)
      JSON.parse(FoldingRelease.run("plutil", "-convert", "json", "-o", "-", path))
    end

    def self.inspect_binary!(application, record)
      identity = record.data.fetch("archive_configuration").fetch("identity")
      paths = [[application, identity.fetch("bundle_id"), true]] +
        Dir.glob(File.join(application, "PlugIns/*.appex")).map { |path| [path, identity.fetch("widget_bundle_id"), false] }
      raise "Expected exactly one widget extension" unless paths.length == 2
      paths.each do |path, bundle, main|
        info = plist(File.join(path, "Info.plist"))
        raise "Binary identity mismatch" unless info["CFBundleIdentifier"] == bundle && info["CFBundleShortVersionString"] == record.data["marketing_version"] && info["CFBundleVersion"] == record.data["build_number"].to_s
        FoldingRelease.run("codesign", "--verify", "--strict", path)
        entitlements = File.join(record.directory, "#{main ? 'app' : 'widget'}-signed-entitlements.plist")
        # codesign emits entitlement XML on stdout; no signing secret is included.
        File.write(entitlements, FoldingRelease.run("codesign", "-d", "--entitlements", ":-", path))
        values = plist(entitlements)
        raise "Wrong signing team" unless values["com.apple.developer.team-identifier"] == record.data.fetch("apple_team_id")
        raise "Development artifact rejected" if values["get-task-allow"] == true
        raise "Wrong application identifier" unless values["application-identifier"] == "#{record.data.fetch('apple_team_id')}.#{bundle}"
        raise "Wrong App Group" unless values["com.apple.security.application-groups"] == [identity.fetch("app_group")]
        if main
          raise "Wrong CloudKit container" unless values["com.apple.developer.icloud-container-identifiers"] == [identity.fetch("cloudkit_container")]
          raise "Wrong distribution environments" unless values["com.apple.developer.icloud-container-environment"] == "Production" && values["com.apple.developer.devicecheck.appattest-environment"] == "production" && values["aps-environment"] == "production"
          raise "Wrong source commit in signed app" unless info["FoldingSourceCommit"] == record.data.fetch("commit_sha")
          raise "Wrong runtime distribution configuration" unless info["FoldingICloudEnvironment"] == "Production" && info["FoldingAttestEnvironment"] == "production" && info["FoldingAPNSEnvironment"] == "production" && info["FoldingAppGroupIdentifier"] == identity.fetch("app_group") && info["FoldingCloudContainerIdentifier"] == identity.fetch("cloudkit_container")
          raise "Wrong backend configuration" unless info["FoldingAPIOrigin"] == record.data.fetch("archive_configuration").fetch("api_origin") && info["FoldingEnvironment"] == record.data.fetch("environment")
          binary = File.join(path, info.fetch("CFBundleExecutable"))
          contents = File.binread(binary)
          raise "Screenshot fixture leaked into device artifact" if contents.include?("folding.screenshot.ready")
          raise "Development storage leaked into device artifact" if contents.include?("FoldingDevelopment")
        end
      end
    end

    def self.archive(context, record, preview: false)
      return %w[archive ipa dsym].each { |kind| record.artifact(kind) } if STATES.index(record.data.fetch("state")) >= STATES.index("archived")
      if preview
        require_state!(record, "planned")
        raise "TestFlight preview requires a 0.x version" unless record.data.fetch("marketing_version").start_with?("0.")
        FoldingRelease.preview_prerequisites!(record)
      else
        require_state!(record, "assets_ready")
      end
      FoldingRelease.clean_commit!
      restore_assets(record) unless preview
      if record.data["archive_candidates"]
        return publish_archive(record)
      end
      raise "Archive was already attempted; reconcile outputs, never silently rebuild this reservation" if record.data["archive_attempt_started_at"]
      identity = record.data.fetch("archive_configuration").fetch("identity")
      keychain = "folding-release-#{SecureRandom.hex(8)}"
      password = SecureRandom.hex(32)
      attempts = record.data.fetch("signing_attempts", []) + [{"started_at" => Time.now.utc.iso8601, "build_number" => record.data.fetch("build_number")}]
      record.save("signing_attempts" => attempts)
      begin
        context.create_keychain(name: keychain, password: password, default_keychain: false, unlock: true, timeout: 3600, lock_when_sleeps: true)
        context.match(type: "appstore", readonly: true, app_identifier: [identity.fetch("bundle_id"), identity.fetch("widget_bundle_id")],
          git_url: "git@github.com:0x63616c/folding-signing.git", api_key: FoldingRelease.api_key, team_id: record.data.fetch("apple_team_id"),
          keychain_name: keychain, keychain_password: password)
        app_profile = ENV.fetch("sigh_#{identity.fetch('bundle_id')}_appstore_profile-name")
        widget_profile = ENV.fetch("sigh_#{identity.fetch('widget_bundle_id')}_appstore_profile-name")
        settings = {
          "MARKETING_VERSION" => record.data.fetch("marketing_version"), "CURRENT_PROJECT_VERSION" => record.data.fetch("build_number").to_s,
          "DEVELOPMENT_TEAM" => record.data.fetch("apple_team_id"), "CODE_SIGN_STYLE" => "Manual", "CODE_SIGN_IDENTITY" => "Apple Distribution",
          "FOLDING_APP_BUNDLE_ID" => identity.fetch("bundle_id"), "FOLDING_WIDGET_BUNDLE_ID" => identity.fetch("widget_bundle_id"),
          "FOLDING_APP_PROFILE_SPECIFIER" => app_profile, "FOLDING_WIDGET_PROFILE_SPECIFIER" => widget_profile,
          "FOLDING_APP_GROUP_IDENTIFIER" => identity.fetch("app_group"), "FOLDING_CLOUD_CONTAINER_IDENTIFIER" => identity.fetch("cloudkit_container"),
          "FOLDING_SOURCE_COMMIT" => record.data.fetch("commit_sha"),
          "FOLDING_API_ORIGIN" => record.data.fetch("archive_configuration").fetch("api_origin"), "FOLDING_ENVIRONMENT" => record.data.fetch("environment"),
          "FOLDING_ICLOUD_ENVIRONMENT" => "Production", "FOLDING_ATTEST_ENVIRONMENT" => "production", "FOLDING_APNS_ENVIRONMENT" => "production"
        }
        archive = File.join(record.directory, "Folding.xcarchive")
        ipa = File.join(record.directory, "Folding.ipa")
        record.save("archive_attempt_started_at" => Time.now.utc.iso8601)
        context.build_app(project: File.join(ROOT, "apps/ios/Folding.xcodeproj"), scheme: CONFIG.fetch("scheme"),
          configuration: CONFIG.fetch("archive_configuration"), clean: true, archive_path: archive,
          output_directory: record.directory, output_name: "Folding.ipa", export_method: "app-store",
          export_team_id: record.data.fetch("apple_team_id"), skip_profile_detection: true,
          export_options: {signingStyle: "manual", signingCertificate: "Apple Distribution",
            provisioningProfiles: {identity.fetch("bundle_id") => app_profile, identity.fetch("widget_bundle_id") => widget_profile}},
          xcargs: settings.map { |key, value| Shellwords.escape("#{key}=#{value}") }.join(" "),
          include_symbols: true, xcodebuild_formatter: "")
        apps = Dir.glob(File.join(archive, "Products/Applications/*.app"))
        raise "Ambiguous archived app" unless apps.length == 1
        inspect_binary!(apps.first, record)
        Dir.mktmpdir("folding-ipa-inspect") do |directory|
          FoldingRelease.run("ditto", "-x", "-k", ipa, directory)
          packaged = Dir.glob(File.join(directory, "Payload/*.app"))
          raise "Ambiguous packaged app" unless packaged.length == 1
          inspect_binary!(packaged.first, record)
        end
        archive_zip = File.join(record.directory, "Folding.xcarchive.zip")
        dsym_zip = File.join(record.directory, "Folding.dSYMs.zip")
        FoldingRelease.run("ditto", "-c", "-k", "--keepParent", archive, archive_zip)
        raise "Missing dSYMs" if Dir.glob(File.join(archive, "dSYMs/*.dSYM")).empty?
        FoldingRelease.run("ditto", "-c", "-k", "--keepParent", File.join(archive, "dSYMs"), dsym_zip)
        artifacts = {"archive" => archive_zip, "ipa" => ipa, "dsym" => dsym_zip}
        record.save("archive_candidates" => artifacts.to_h { |kind, file| [kind, {"name" => File.basename(file), "sha256" => FoldingRelease.sha(file)}] })
        publish_archive(record)
      ensure
        context.delete_keychain(name: keychain)
      end
    end

    # An ambiguous build attempt burns its number. Signing-only failures can retry
    # normally because archive_attempt_started_at is set immediately before build_app.
    def self.replace_interrupted_archive(record, reason:)
      require_state!(record, "assets_ready")
      record.verify_identity!
      raise "Recovery needs an audit reason" if reason.to_s.strip.empty?
      raise "No interrupted archive" unless record.data["archive_attempt_started_at"]
      raise "Publish sealed artifacts instead" if record.data["archive_candidates"]
      source = record.data.fetch("commit_sha")
      old_number = record.data.fetch("build_number")
      actor = JSON.parse(FoldingRelease.run("gh", "api", "user")).fetch("login")
      builds = %w[production staging].flat_map do |environment|
        identity = FoldingRelease.configuration(environment).fetch("identity")
        app = Spaceship::ConnectAPI::App.find(identity.fetch("bundle_id"), client: FoldingRelease.client)
        raise "Missing registered app" unless app && app.id == identity.fetch("app_store_id")
        app.get_builds(client: FoldingRelease.client).map { |build| Integer(build.version, 10) }
      end
      raise "Old build exists on Apple; reconcile it instead" if builds.include?(old_number)
      ledger_store = GitHubArtifacts.new(CONFIG.fetch("reservation_tag"))
      ledger = ledger_store.latest("reservations") or raise "Missing reservation ledger"
      key = "replacement:#{record.data.fetch('release_id')}:#{old_number}"
      reservation = ledger.fetch("reservations").find { |entry| entry["idempotency_key"] == key }
      unless reservation
        number = ([0] + builds + ledger.fetch("reservations").map { |entry| entry.fetch("build_number") }).max + 1
        reservation = {"idempotency_key" => key, "tag" => record.data.fetch("tag"), "commit_sha" => source,
          "build_number" => number, "replaces_build_number" => old_number, "actor" => actor,
          "reason" => reason, "created_at" => Time.now.utc.iso8601}
        ledger["reservations"] << reservation
        ledger["revision"] += 1
        Dir.mktmpdir("folding-reservation") do |directory|
          file = File.join(directory, format("reservations-r%08d.json", ledger.fetch("revision")))
          FoldingRelease.atomic_json(file, ledger)
          ledger_store.upload(file)
        end
      end
      # Keep old local outputs for inspection, outside the new build's fixed paths.
      retired = File.join(record.directory, "retired-build-#{old_number}")
      FileUtils.mkdir_p(retired)
      %w[Folding.xcarchive Folding.ipa Folding.xcarchive.zip Folding.dSYMs.zip].each do |name|
        path = File.join(record.directory, name)
        next unless File.exist?(path)
        raise "Retired output already exists; reconcile manually" if File.exist?(File.join(retired, name))
        FileUtils.mv(path, retired)
      end
      record.save("build_number" => reservation.fetch("build_number"), "archive_attempt_started_at" => nil,
        "archive_recoveries" => record.data.fetch("archive_recoveries", []) + [reservation])
    end

    def self.publish_archive(record)
      candidates = record.data.fetch("archive_candidates")
      paths = candidates.to_h do |kind, candidate|
        raise "Invalid archive artifact path" unless File.basename(candidate.fetch("name")) == candidate.fetch("name")
        path = File.join(record.directory, candidate.fetch("name"))
        record.remote.download(candidate.fetch("name"), record.directory) unless File.exist?(path)
        raise "Archive candidate changed; never rebuild this reservation" unless FoldingRelease.sha(path) == candidate.fetch("sha256")
        [kind, path]
      end
      paths.each_value { |file| record.remote.upload_artifact(file) }
      record.advance("archived", candidates.to_h { |kind, candidate| ["#{kind}_sha256", candidate.fetch("sha256")] }.merge(
        "artifacts" => record.data.fetch("artifacts").merge(candidates.transform_values { |candidate| candidate.fetch("name") })))
    end

    def self.verify_processed!(record)
      build = FoldingRelease.exact_build(record.data)
      raise "Exact Apple build is not processed" unless build && build.processing_state == "VALID"
      raise "Apple build identity changed" if record.data["asc_build_id"] && record.data["asc_build_id"] != build.id
      raise "Encryption compliance incomplete" if build.uses_non_exempt_encryption.nil?
      build
    end

    def self.beta(context, record)
      record.verify_identity!
      FoldingRelease.preview_prerequisites!(record) if record.data.fetch("marketing_version").start_with?("0.")
      raise "Archive required" if STATES.index(record.data.fetch("state")) < STATES.index("archived")
      build = FoldingRelease.exact_build(record.data)
      unless build
        raise "Previous upload outcome is ambiguous; inspect Apple before explicit retry" if record.data["upload_attempt_started_at"]
        record.save("upload_attempt_started_at" => Time.now.utc.iso8601)
        context.upload_to_testflight(api_key: FoldingRelease.api_key, app_identifier: record.data.fetch("bundle_id"),
          apple_id: record.data.fetch("asc_app_id"), ipa: record.artifact("ipa"),
          skip_waiting_for_build_processing: true, skip_submission: true)
        record.advance("uploaded")
      end
      # One read per invocation; a processing build resumes via the same lane without a new upload.
      build = verify_processed!(record)
      if STATES.index(record.data.fetch("state")) <= STATES.index("processed")
        record.advance("processed", "asc_build_id" => build.id, "asc_processing_state" => build.processing_state)
      end
      groups = ENV.fetch(CONFIG.fetch("testflight_groups_env")).split(",").map(&:strip).reject(&:empty?)
      raise "Explicit TestFlight groups are required" if groups.empty?
      if record.data["testflight_distributed_build_id"] == build.id
        raise "Previously distributed groups differ" unless record.data["testflight_groups"] == groups
        return
      end
      context.upload_to_testflight(api_key: FoldingRelease.api_key, app_identifier: record.data.fetch("bundle_id"),
        apple_id: record.data.fetch("asc_app_id"), app_platform: "ios",
        app_version: record.data.fetch("marketing_version"), build_number: record.data.fetch("build_number").to_s,
        distribute_only: true, groups: groups, distribute_external: false,
        submit_beta_review: false, notify_external_testers: false)
      record.save("testflight_distributed_build_id" => build.id, "testflight_groups" => groups)
    end

    def self.version(record)
      matches = FoldingRelease.app(record.data).get_app_store_versions(client: FoldingRelease.client,
        filter: {versionString: record.data.fetch("marketing_version"), platform: "IOS"})
      raise "Expected exact App Store version" unless matches.length == 1
      matches.first
    end

    def self.observe_submission(record)
      selected = version(record)
      build = selected.get_build(client: FoldingRelease.client)
      raise "Submitted version points to wrong build" unless build && build.id == record.data.fetch("asc_build_id")
      raise "Automatic release not enabled" unless selected.release_type == "AFTER_APPROVAL"
      submissions = FoldingRelease.app(record.data).get_review_submissions(client: FoldingRelease.client, includes: "appStoreVersionForReview")
      matches = submissions.select { |submission| submission.app_store_version_for_review&.id == selected.id && %w[WAITING_FOR_REVIEW IN_REVIEW].include?(submission.state) }
      return false if matches.empty?
      raise "Ambiguous review submission" unless matches.length == 1
      submission = matches.first
      raise "Apple submission identity differs" unless submission.id == record.data.fetch("prepared_submission_id")
      ReviewSubmission.verify_items!(record)
      record.advance("submitted", "submission_id" => submission.id, "submission_state" => submission.state, "automatic_release" => true)
      record.remote.publish
      true
    end

    # Upload and verify the listing without requesting App Review.
    def self.storefront(context, record, evidence_path)
      preflight(record, evidence_path, final: true)
      raise "Expected processed or ready_to_submit" unless %w[processed ready_to_submit].include?(record.data.fetch("state"))
      assets = restore_assets(record)
      contact = CONFIG.fetch("review_contact_env").transform_values { |name| ENV.fetch(name) }
      options = {api_key: FoldingRelease.api_key, app_identifier: record.data.fetch("bundle_id"),
        app_version: record.data.fetch("marketing_version"), build_number: record.data.fetch("build_number").to_s,
        skip_binary_upload: true, metadata_path: File.join(assets, "metadata"), screenshots_path: File.join(assets, "screenshots"),
        overwrite_screenshots: true, force: true, automatic_release: true,
        run_precheck_before_submit: true, precheck_include_in_app_purchases: false,
        app_review_information: contact.merge("demo_account_required" => false, "notes" => File.read(File.join(ROOT, "fastlane/review-notes.txt")))}
      if record.data["state"] == "processed" && !record.data["storefront_upload_completed_at"]
        context.upload_to_app_store(**options.merge(submit_for_review: false))
        record.save("storefront_upload_completed_at" => Time.now.utc.iso8601)
      end
      selected = version(record)
      raise "Listing not attached to exact build" unless selected.get_build(client: FoldingRelease.client)&.id == record.data.fetch("asc_build_id")
      StorefrontReadback.verify!(record, selected)
      record.advance("ready_to_submit") if record.data["state"] == "processed"
      selected
    end

    def self.submit(context, record, evidence_path)
      preflight(record, evidence_path, final: true)
      return if record.data["submission_id"] && observe_submission(record)
      if record.data["submission_attempt_started_at"]
        return if observe_submission(record)
        raise "Submission outcome pending/ambiguous; inspect Apple, do not submit again automatically"
      end
      raise "Expected processed or ready_to_submit" unless %w[processed ready_to_submit].include?(record.data.fetch("state"))
      selected = storefront(context, record, evidence_path)
      ReviewSubmission.prepare(record, selected.id)
      record.save("submission_attempt_started_at" => Time.now.utc.iso8601)
      ReviewSubmission.submit(record)
      raise "Submission sent; Apple readback is pending. Resume to observe, not resubmit." unless observe_submission(record)
    end
  end
end
