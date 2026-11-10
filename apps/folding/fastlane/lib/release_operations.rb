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
      return restore_assets(record) if record.data.fetch("state") != "validated" && record.data.fetch("artifacts").key?("assets")
      raise "Expected validated or processed release" unless %w[validated processed].include?(record.data.fetch("state"))
      record.verify_identity!
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
      changes = manifest_hashes.merge("assets_sha256" => FoldingRelease.sha(bundle),
        "artifacts" => record.data.fetch("artifacts").merge("assets" => File.basename(bundle)))
      record.data.fetch("state") == "validated" ? record.advance("assets_ready", changes) : record.save(changes)
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
        raise "Folding must ship for iPhone only" unless info["UIDeviceFamily"] == [1]
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
        signing = {type: "appstore", readonly: true, app_identifier: [identity.fetch("bundle_id"), identity.fetch("widget_bundle_id")],
          git_url: ENV.fetch("FOLDING_SIGNING_GIT_URL", "git@github.com:0x63616c/folding-signing.git"),
          api_key: FoldingRelease.api_key, team_id: record.data.fetch("apple_team_id"),
          keychain_name: keychain, keychain_password: password}
        private_key = ENV["FOLDING_SIGNING_GIT_PRIVATE_KEY"]
        signing[:git_private_key] = private_key unless private_key.to_s.strip.empty?
        context.match(**signing)
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
      return FoldingRelease.follow_replacement(record.data.fetch("tag")) if record.data["replacement_tag"]
      record.verify_identity!
      allowed = record.data["preview_backend_verification"] ? "planned" : "assets_ready"
      require_state!(record, allowed)
      raise "Recovery needs an audit reason" if reason.to_s.strip.empty?
      raise "No interrupted archive" unless record.data["archive_attempt_started_at"]
      raise "Publish sealed artifacts instead" if record.data["archive_candidates"]
      old_number = record.data.fetch("build_number")
      actor = FoldingRelease.release_actor
      identity = FoldingRelease.configuration("production").fetch("identity")
      app = Spaceship::ConnectAPI::App.find(identity.fetch("bundle_id"), client: FoldingRelease.client)
      raise "Missing registered app" unless app && app.id == identity.fetch("app_store_id")
      builds = app.get_builds(client: FoldingRelease.client).map { |build| Integer(build.version, 10) }
      raise "Old build exists on Apple; reconcile it instead" if builds.include?(old_number)
      replacement = FoldingRelease.reserve(environment: record.data.fetch("environment"),
        version: record.data.fetch("marketing_version"), replacement_for: record.data.fetch("release_id"))
      audit = {"actor" => actor, "reason" => reason, "replaced_tag" => record.data.fetch("tag"),
        "replaced_build_number" => old_number, "created_at" => Time.now.utc.iso8601}
      unless replacement.data["archive_replacement"]
        replacement.save("archive_replacement" => audit)
      end
      record.save("cancelled" => true, "replacement_tag" => replacement.data.fetch("tag"),
        "archive_recovery" => audit)
      # Old files and every historical manifest stay under the burned build tag.
      # The replacement starts at planned and repeats preparation for its own identity.
      replacement
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

    def self.register_build_policy(record)
      deployment = FoldingRelease.read_json(ENV.fetch("FOLDING_BACKEND_DEPLOYMENT_RECEIPT"))
      config = deployment.fetch("runtime_configuration")
      directory = record.directory
      receipt = File.join(directory, "published-build-receipt.json")
      recorded = record.data["build_policy_receipt_sha256"]
      name = "published-build-#{record.data.fetch('build_number')}.json"
      remote_receipt = record.remote.info.fetch("assets").any? { |asset| asset.fetch("name") == name }
      if (recorded || remote_receipt) && !File.exist?(receipt)
        record.remote.download(name, directory)
        FileUtils.mv(File.join(directory, name), receipt)
      end
      raise "Published build receipt changed" if recorded && FoldingRelease.sha(receipt) != recorded
      confirm_only = recorded || record.data["build_policy_registration_started_at"] || File.exist?(receipt) || remote_receipt
      # Persist intent before the first write. A crash on either side of D1 must
      # resume with readback, including when the receipt/checkpoint was never saved.
      record.save("build_policy_registration_started_at" => Time.now.utc.iso8601) unless confirm_only
      Dir.mktmpdir("folding-release-policy") do |scratch|
        configuration = File.join(scratch, "configuration.json")
        FoldingRelease.atomic_json(configuration, config)
        arguments = ["python3", File.join(ROOT, "scripts/register-published-build.py"), "--record", record.path,
          "--configuration", configuration, "--receipt", receipt]
        arguments << "--read-only" if confirm_only
        FoldingRelease.run(*arguments)
      end
      unless recorded
        artifact = File.join(directory, name)
        FileUtils.cp(receipt, artifact)
        record.remote.upload_artifact(artifact)
        record.save("build_policy_receipt_sha256" => FoldingRelease.sha(receipt), "build_policy_receipt_name" => name)
      end
    end

    def self.continuous_beta(context, version:, evidence_path:)
      evidence = FoldingRelease.read_json(evidence_path)
      source = FoldingRelease.clean_commit!
      raise "Beta evidence belongs to another source" unless evidence.fetch("commit_sha") == source
      %w[contracts domain-storage native-build localization].each do |name|
        checks = evidence.fetch("required_checks").select { |check| check["name"] == name }
        raise "Missing or duplicated beta CI evidence: #{name}" unless checks.length == 1 && checks.first["kind"] == "ci"
        CheckEvidence.validate!(checks.first, source: source, base: File.dirname(File.expand_path(evidence_path)))
      end
      record = FoldingRelease.reserve(environment: "production", version: version)
      floor = FoldingRelease.minimum_supported_build("production")
      if record.data.fetch("build_number") < floor
        replacement = FoldingRelease.reserve(environment: "production", version: version,
          replacement_for: "minimum-build:#{record.data.fetch('release_id')}:#{floor}")
        replacement.save("minimum_build_replacement" => {"replaced_tag" => record.data.fetch("tag"), "minimum_ios_build" => floor})
        record.save("cancelled" => true, "replacement_tag" => replacement.data.fetch("tag"), "retired_by_minimum_build" => floor)
        record = replacement
      end
      # A confirmed interrupted compile burns its reservation. Sealed archive
      # candidates are reconciled by archive rather than built a second time.
      if record.data["archive_attempt_started_at"] && !record.data["archive_candidates"] && record.data["state"] == "planned"
        record = replace_interrupted_archive(record, reason: "Resume interrupted automatic internal beta archive")
      end
      record.save("beta_source_checks" => evidence.fetch("required_checks"))
      archive(context, record, preview: true) if record.data.fetch("state") == "planned"
      beta(context, record, wait_for_processing: true)
      record
    end

    def self.beta(context, record, wait_for_processing: false)
      record.verify_identity!
      if record.data["preview_backend_verification"]
        FoldingRelease.preview_prerequisites!(record)
      else
        worker = FoldingRelease.live_prerequisites!(record)
        record.save("deployed_worker_version" => worker)
      end
      raise "Archive required" if STATES.index(record.data.fetch("state")) < STATES.index("archived")
      register_build_policy(record)
      build = FoldingRelease.exact_build(record.data)
      unless build
        if record.data["upload_attempt_started_at"]
          raise "Previous upload outcome is ambiguous; inspect Apple before explicit retry" unless wait_for_processing
        else
          record.save("upload_attempt_started_at" => Time.now.utc.iso8601)
          context.upload_to_testflight(api_key: FoldingRelease.api_key, app_identifier: record.data.fetch("bundle_id"),
            apple_id: record.data.fetch("asc_app_id"), ipa: record.artifact("ipa"),
            skip_waiting_for_build_processing: true, skip_submission: true)
          record.advance("uploaded")
        end
      end
      if wait_for_processing
        deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 3600
        loop do
          build = FoldingRelease.exact_build(record.data)
          break if build && build.processing_state == "VALID"
          raise "Apple rejected this immutable build" if build && %w[FAILED INVALID].include?(build.processing_state)
          raise "Apple processing is still pending; rerun the same source to reconcile without uploading again" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
          sleep 30
        end
      end
      # One read per invocation; a processing build resumes via the same lane without a new upload.
      build = verify_processed!(record)
      if STATES.index(record.data.fetch("state")) <= STATES.index("processed")
        record.advance("processed", "asc_build_id" => build.id, "asc_processing_state" => build.processing_state)
      end
      groups = ENV.fetch(CONFIG.fetch("testflight_groups_env")).split(",").map(&:strip).reject(&:empty?)
      if wait_for_processing && record.data.fetch("build_number") < FoldingRelease.minimum_supported_build(record.data.fetch("environment"))
        raise "Build was retired while Apple processed it; do not distribute"
      end
      raise "Explicit unique TestFlight groups are required" if groups.empty? || groups.uniq != groups
      resolved = internal_groups(record, groups)
      if record.data["testflight_distributed_build_id"] == build.id
        raise "Previously distributed groups differ" unless record.data["testflight_groups"] == groups
        raise "Previously recorded group membership is no longer present" unless groups_include_build?(resolved, build.id)
      elsif !groups_include_build?(resolved, build.id)
        manual = resolved.reject(&:has_access_to_all_builds)
        unless manual.empty? || record.data["testflight_assignment_attempt_started_at"]
          record.save("testflight_assignment_attempt_started_at" => Time.now.utc.iso8601)
          context.upload_to_testflight(api_key: FoldingRelease.api_key, app_identifier: record.data.fetch("bundle_id"),
            apple_id: record.data.fetch("asc_app_id"), app_platform: "ios",
            app_version: record.data.fetch("marketing_version"), build_number: record.data.fetch("build_number").to_s,
            distribute_only: true, groups: manual.map(&:name), distribute_external: false,
            submit_beta_review: false, notify_external_testers: false)
        end
        deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + (wait_for_processing ? 120 : 0)
        until groups_include_build?(resolved, build.id)
          raise "Internal group assignment is not confirmed; reconcile the existing attempt before retrying" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
          sleep 10
        end
      end
      record.save("testflight_distributed_build_id" => build.id, "testflight_groups" => groups,
        "testflight_group_ids" => resolved.map(&:id), "testflight_group_assignment_verified_at" => Time.now.utc.iso8601)
    end

    def self.internal_groups(record, names)
      available = FoldingRelease.app(record.data).get_beta_groups(client: FoldingRelease.client)
      names.map do |name|
        matching = available.select { |group| group.name == name }
        raise "Configured TestFlight group is missing or ambiguous" unless matching.length == 1
        group = matching.first
        raise "Only explicitly internal TestFlight groups are allowed" unless group.is_internal_group == true && !group.public_link_enabled && !group.id.to_s.empty?
        group
      end
    end

    def self.groups_include_build?(groups, build_id)
      groups.all? do |group|
        pages = FoldingRelease.client.get_builds_for_beta_group(group_id: group.id).all_pages
        pages.flat_map(&:to_models).any? { |build| build.id == build_id }
      end
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

    def self.review_contact(record)
      contact = CONFIG.fetch("review_contact_env").transform_values { |name| ENV[name] }
      return contact if contact.values.all? { |value| !value.to_s.strip.empty? }
      detail = version(record).fetch_app_store_review_detail(client: FoldingRelease.client)
      raise "Existing Apple review contact is incomplete" unless detail &&
        [detail.contact_first_name, detail.contact_last_name, detail.contact_phone, detail.contact_email].all? { |value| !value.to_s.strip.empty? }
      # Deliver prints its options. Keep the verified contact in Apple rather
      # than forwarding private provider values to its configuration summary.
      {}
    end

    # Upload and verify the listing without requesting App Review.
    def self.storefront(context, record, evidence_path = nil)
      evidence_path ? preflight(record, evidence_path, final: true) : AutomaticRelease.preflight(record)
      raise "Expected processed or ready_to_submit" unless %w[processed ready_to_submit].include?(record.data.fetch("state"))
      assets = restore_assets(record)
      contact = review_contact(record)
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
      # Deliver with submit_for_review:false uploads metadata but does not select
      # its build_number. Our separate joint app/tip submission owns attachment.
      selected.select_build(client: FoldingRelease.client, build_id: verify_processed!(record).id)
      selected = version(record)
      raise "Listing not attached to exact build" unless selected.get_build(client: FoldingRelease.client)&.id == record.data.fetch("asc_build_id")
      StorefrontReadback.verify!(record, selected)
      record.advance("ready_to_submit") if record.data["state"] == "processed"
      selected
    end

    def self.submit(context, record, evidence_path = nil)
      evidence_path ? preflight(record, evidence_path, final: true) : AutomaticRelease.preflight(record)
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
