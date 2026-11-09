require_relative "release_manifest"

module FoldingRelease
  # Product-owned deployment adapter: existing Wrangler configuration/migrations,
  # tested CI Wasm bytes, and the existing release evidence validator.
  module BackendDelivery
    ENVIRONMENT = "production"
    Record = Struct.new(:data) do
      def save(values); data.merge!(values); end
    end

    def self.configuration(source)
      value = JSON.parse(ENV.fetch("FOLDING_PRODUCTION_WORKER_CONFIG"))
      identity = FoldingAppleAccount.config.fetch(ENVIRONMENT)
      variables = value.fetch("vars")
      database = value.fetch("d1_databases")
      raise "Wrong production Worker configuration" unless value["name"] == "folding-api-production" &&
        value.fetch("account_id").match?(/\A[0-9a-f]{32}\z/) && variables["DEPLOYMENT"] == ENVIRONMENT &&
        variables["APP_ATTEST_APP_ID"] == "#{CONFIG.fetch('apple_team_id')}.#{identity.fetch('bundle_id')}" &&
        database.length == 1 && database.first["binding"] == "DB" && database.first["database_name"] == "folding-production"
      claims = JSON.parse(variables.fetch("VERIFIED_CAPABILITIES"))
      raise "Invalid configured capability claims" unless claims.is_a?(Array) && claims.uniq == claims && claims.all? { |claim| claim.is_a?(String) && !claim.empty? }
      flags = %w[APNS_ENABLED AVATAR_UPLOADS_ENABLED ADMIN_EMAIL_ENABLED]
      raise "Explicit configured feature flags are required" unless flags.all? { |name| %w[true false].include?(variables.fetch(name)) }
      promoted = !claims.empty? || %w[APNS_ENABLED AVATAR_UPLOADS_ENABLED ADMIN_EMAIL_ENABLED].any? { |name| variables[name] == "true" }
      approved = variables.fetch("WORKER_VERSION")
      raise "Invalid approved Worker source" unless approved.match?(/\A[0-9a-f]{40}\z/)
      if promoted && approved != source && FoldingRelease.backend_input_hash(approved) != FoldingRelease.backend_input_hash(source)
        raise "Refresh the source-bound configuration through the existing readiness/evidence generator before deploying changed backend inputs"
      end
      variables["WORKER_VERSION"] = source
      value["main"] = File.join(ROOT, "backend/crates/worker/build/worker/shim.mjs")
      database.first["migrations_dir"] = File.join(ROOT, "backend/migrations")
      value
    end

    def self.provider(configuration, suffix)
      FoldingRelease.fetch_json("https://api.cloudflare.com/client/v4/accounts/#{configuration.fetch('account_id')}/workers/scripts/#{configuration.fetch('name')}/#{suffix}",
        {"Authorization" => "Bearer #{ENV.fetch('FOLDING_RELEASE_POLICY_TOKEN')}"})
    end

    def self.current(configuration)
      deployment = provider(configuration, "deployments")
      versions = deployment.dig("result", "deployments", 0, "versions")
      raise "Expected one current production Worker version" unless deployment["success"] == true && versions.is_a?(Array) &&
        versions.length == 1 && versions.first["percentage"] == 100 && versions.first["version_id"].to_s.match?(/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/)
      version = versions.first.fetch("version_id")
      uploaded = provider(configuration, "versions/#{version}")
      bindings = uploaded.dig("result", "resources", "bindings")
      raise "Cannot identify current Worker source" unless uploaded["success"] == true && uploaded.dig("result", "id") == version && bindings.is_a?(Array)
      %w[DEPLOYMENT APP_ATTEST_APP_ID].each do |name|
        matching = bindings.select { |binding| binding["name"] == name }
        raise "Live Worker belongs to another application/environment" unless matching.length == 1 && matching.first["type"] == "plain_text" && matching.first["text"] == configuration.fetch("vars").fetch(name)
      end
      database = bindings.select { |binding| binding["name"] == "DB" }
      raise "Configured migration database is not bound to the live Worker" unless database.length == 1 && database.first["type"] == "d1" &&
        database.first["id"] == configuration.fetch("d1_databases").first.fetch("database_id")
      sources = bindings.select { |binding| binding["name"] == "WORKER_VERSION" && binding["type"] == "plain_text" }
      raise "Missing unique Worker source binding" unless sources.length == 1 && sources.first["text"].to_s.match?(/\A[0-9a-f]{40}\z/)
      [sources.first.fetch("text"), version]
    end

    def self.store
      GitHubArtifacts.new("folding/backend-production")
    end

    def self.native_input_hash(source)
      FoldingRelease.run("python3", File.expand_path("../../scripts/ci/input_hash.py", ROOT), "folding.native", source)
    end

    def self.superseded?(source, delivered)
      return false if source == delivered
      _out, _error, status = Open3.capture3("git", "merge-base", "--is-ancestor", source, delivered, chdir: ROOT)
      status.success?
    end

    def self.native_needed?
      source = FoldingRelease.clean_commit!
      delivered = store.latest("native-delivery")
      return true unless delivered
      return false if superseded?(source, delivered.fetch("source_sha"))
      delivered.fetch("input_hash") != native_input_hash(source)
    end

    def self.record_native_delivery(record)
      source = record.data.fetch("commit_sha")
      raise "Record a confirmed processed distribution only" unless record.data["testflight_distributed_build_id"] && record.data["asc_processing_state"] == "VALID"
      raise "Internal-group readback is required before recording delivery" unless record.data["testflight_group_ids"].is_a?(Array) && !record.data["testflight_group_ids"].empty? && record.data["testflight_group_assignment_verified_at"]
      5.times do
        delivered = store.latest("native-delivery")
        return if delivered && ((delivered["source_sha"] == source && delivered["asc_build_id"] == record.data.fetch("testflight_distributed_build_id")) || superseded?(source, delivered.fetch("source_sha")))
        raise "Cannot roll back a newer distributed build of this source" if delivered && delivered["source_sha"] == source && delivered.fetch("build_number", 0) >= record.data.fetch("build_number")
        receipt = {"schema_version" => 1, "revision" => (delivered ? delivered.fetch("revision") : 0) + 1,
          "source_sha" => source, "input_hash" => native_input_hash(source), "release_tag" => record.data.fetch("tag"),
          "asc_build_id" => record.data.fetch("testflight_distributed_build_id"), "build_number" => record.data.fetch("build_number")}
        begin
          Dir.mktmpdir("folding-native-delivery") do |directory|
            path = File.join(directory, format("native-delivery-r%08d.json", receipt.fetch("revision")))
            FoldingRelease.atomic_json(path, receipt)
            store.upload(path)
          end
          return
        rescue StandardError
          next
        end
      end
      raise "Could not confirm durable native delivery; retry to reconcile the distributed build"
    end

    def self.receipt_name(source, version)
      "backend-#{source}-#{version}.json"
    end

    def self.download(directory)
      source = FoldingRelease.clean_commit!
      configuration = configuration(source)
      worker_source, version = current(configuration)
      name = receipt_name(worker_source, version)
      FileUtils.mkdir_p(directory)
      path = File.join(directory, name)
      store.download(name, directory) unless File.exist?(path)
      path
    end

    def self.verify_artifact!(source)
      directory = File.join(ROOT, "backend/crates/worker/build")
      manifest = FoldingRelease.read_json(File.join(directory, "artifact.json"))
      expected = %w[index.js index_bg.wasm package.json worker/shim.mjs]
      raise "Wrong tested Worker artifact" unless manifest["source_sha"] == source && manifest.fetch("files").keys.sort == expected.sort
      actual = Dir.glob(File.join(directory, "**/*"), File::FNM_DOTMATCH).select { |file| File.file?(file) }.map { |file| file.delete_prefix(directory + "/") }
      raise "Unexpected Worker artifact files" unless actual.sort == (expected + ["artifact.json"]).sort
      expected.each do |name|
        path = File.join(directory, name)
        raise "Tested Worker bytes changed" if File.symlink?(path) || FoldingRelease.sha(path) != manifest.fetch("files").fetch(name)
      end
    end

    def self.deploy(run_url:)
      source = FoldingRelease.clean_commit!
      check = {"kind" => "ci", "name" => "backend", "commit_sha" => source, "conclusion" => "success", "run_url" => run_url}
      CheckEvidence.validate!(check, source: source, base: ROOT)
      verify_artifact!(source)
      config = configuration(source)
      existing_source, _version = current(config)
      return if superseded?(source, existing_source)
      store.ensure_exists(source)
      previous = ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"]
      Dir.mktmpdir("folding-worker-delivery") do |directory|
        path = File.join(directory, "wrangler.json")
        FoldingRelease.atomic_json(path, config)
        wrangler = ["node", File.join(ROOT, "backend/node_modules/wrangler/bin/wrangler.js")]
        bookmark = nil
        unless existing_source == source
          recovery_name = "recovery-#{source}.json"
          recovery = File.join(directory, recovery_name)
          prior_recovery = store.info.fetch("assets").any? { |asset| asset.fetch("name") == recovery_name }
          if prior_recovery
            store.download(recovery_name, directory)
            before = FoldingRelease.read_json(recovery)
            raise "Recovery bookmark belongs to another source/database" unless before["source_sha"] == source && before["database_id"] == config.fetch("d1_databases").first.fetch("database_id")
            bookmark = before.fetch("bookmark")
          else
            bookmark = JSON.parse(FoldingRelease.run(*wrangler, "d1", "time-travel", "info", "DB", "--config", path, "--json")).fetch("bookmark")
          end
          raise "Missing pre-migration recovery bookmark" unless bookmark.is_a?(String) && bookmark.match?(/\A[A-Za-z0-9:-]{1,200}\z/)
          # Publish recovery metadata before any schema/code mutation. No database rows.
          FoldingRelease.atomic_json(recovery, {"source_sha" => source, "database_id" => config.fetch("d1_databases").first.fetch("database_id"), "bookmark" => bookmark})
          store.upload_artifact(recovery)
          FoldingRelease.run("python3", File.join(ROOT, "scripts/migrate-d1.py"), "apply", "--configuration", path, "--environment", ENVIRONMENT)
          FoldingRelease.run(*wrangler, "deploy", "--config", path)
        end
        deployed_source, version = current(config)
        raise "Deployed Worker did not confirm this exact source" unless deployed_source == source
        runtime = {"account_id" => config.fetch("account_id"),
          "vars" => config.fetch("vars").slice("WORKER_VERSION", "DEPLOYMENT", "APP_ATTEST_APP_ID"),
          "d1_databases" => config.fetch("d1_databases").map { |db| db.slice("binding", "database_id") }}
        receipt = {"schema_version" => 1, "environment" => ENVIRONMENT, "worker_source_sha" => source,
          "backend_input_hash" => FoldingRelease.backend_input_hash(source), "cloudflare_version_id" => version,
          "account_id" => config.fetch("account_id"), "worker_script" => config.fetch("name"),
          "runtime_configuration" => runtime, "backend_check" => check}
        name = receipt_name(source, version)
        output = File.join(directory, name)
        if store.info.fetch("assets").any? { |asset| asset.fetch("name") == name }
          # A CI rerun adds a new attempt, not a new provider deployment. Keep
          # the original successful attempt's immutable, independently checked proof.
          store.download(name, directory)
        else
          FoldingRelease.atomic_json(output, receipt)
        end
        ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"] = output
        identity = FoldingAppleAccount.config.fetch(ENVIRONMENT)
        record = Record.new({"commit_sha" => source, "environment" => ENVIRONMENT,
          "apple_team_id" => CONFIG.fetch("apple_team_id"), "bundle_id" => identity.fetch("bundle_id")})
        live = FoldingRelease.fetch_json("https://api.getfolding.app/v1/capabilities")
        FoldingRelease.verified_backend!(record, live)
        store.upload_artifact(output)
      ensure
        ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"] = previous
      end
    end
  end
end
