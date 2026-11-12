require "minitest/autorun"
require_relative "../lib/release_manifest"

class BackendInputsTest < Minitest::Test
  def test_backend_receipt_requires_live_complete_version_and_exact_app_database_bindings
    source = "a" * 40
    version = "11111111-2222-3333-4444-555555555555"
    database = "66666666-7777-8888-9999-000000000000"
    account = "b" * 32
    app = "TEAM.example.folding"
    variables = {
      "WORKER_VERSION" => source,
      "DEPLOYMENT" => "production",
      "APP_ATTEST_APP_ID" => app
    }
    receipt = {
      "schema_version" => 1,
      "environment" => "production",
      "worker_source_sha" => source,
      "backend_input_hash" => "hash",
      "cloudflare_version_id" => version,
      "account_id" => account,
      "worker_script" => "folding-api-production",
      "backend_check" => {
        "kind" => "ci",
        "name" => "backend"
      },
      "runtime_configuration" => {
        "account_id" => account,
        "vars" => variables,
        "d1_databases" => [{ "binding" => "DB", "database_id" => database }]
      }
    }
    deployed = {
      "success" => true,
      "result" => {
        "deployments" => [
          { "versions" => [{ "version_id" => version, "percentage" => 100 }] }
        ]
      }
    }
    uploaded = {
      "success" => true,
      "result" => {
        "id" => version,
        "resources" => {
          "bindings" =>
            variables.map do |name, value|
              { "name" => name, "type" => "plain_text", "text" => value }
            end + [{ "name" => "DB", "type" => "d1", "id" => database }]
        }
      }
    }
    record_type =
      Struct.new(:data) do
        def save(values)
          data.merge!(values)
        end
      end
    original_path, original_token =
      ENV.values_at(
        "FOLDING_BACKEND_DEPLOYMENT_RECEIPT",
        "FOLDING_RELEASE_POLICY_TOKEN"
      )
    Dir.mktmpdir do |directory|
      path = File.join(directory, "deployment.json")
      ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"] = path
      ENV["FOLDING_RELEASE_POLICY_TOKEN"] = "synthetic-test-value"
      scenarios = %i[
        valid
        wrong_check
        local_check
        split_traffic
        wrong_version
        wrong_database
        wrong_app
        wrong_receipt_database
        wrong_runtime_source
      ]
      scenarios.each do |scenario|
        current_receipt, current_deployed, current_uploaded =
          [receipt, deployed, uploaded].map do |value|
            Marshal.load(Marshal.dump(value))
          end
        case scenario
        when :wrong_check
          current_receipt["backend_check"]["name"] = "contracts"
        when :local_check
          current_receipt["backend_check"]["kind"] = "local"
        when :split_traffic
          current_deployed["result"]["deployments"][0]["versions"][0][
            "percentage"
          ] = 50
        when :wrong_version
          current_uploaded["result"]["id"] = database
        when :wrong_database
          current_uploaded["result"]["resources"]["bindings"].last[
            "id"
          ] = version
        when :wrong_app
          current_uploaded["result"]["resources"]["bindings"][2][
            "text"
          ] = "TEAM.other"
        when :wrong_runtime_source
          current_uploaded["result"]["resources"]["bindings"][0]["text"] = "c" *
            40
        when :wrong_receipt_database
          current_receipt["runtime_configuration"]["d1_databases"][0][
            "database_id"
          ] = version
        end
        FoldingRelease.atomic_json(path, current_receipt)
        record =
          record_type.new(
            {
              "commit_sha" => source,
              "environment" => "production",
              "apple_team_id" => "TEAM",
              "bundle_id" => "example.folding"
            }
          )
        fetch = ->(url, _headers) do
          url.end_with?("/deployments") ? current_deployed : current_uploaded
        end
        FoldingRelease.stub(:backend_input_hash, "hash") do
          FoldingRelease::CheckEvidence.stub(:validate!, nil) do
            FoldingRelease.stub(:fetch_json, fetch) do
              if scenario == :valid
                assert_equal source,
                             FoldingRelease.verified_backend!(
                               record,
                               { "worker_version" => source }
                             )
                assert_equal FoldingRelease.sha(path),
                             record.data.fetch(
                               "backend_deployment_receipt_sha256"
                             )
              else
                assert_raises(RuntimeError, scenario.to_s) do
                  FoldingRelease.verified_backend!(
                    record,
                    { "worker_version" => source }
                  )
                end
                refute record.data.key?("backend_deployment_receipt_sha256")
              end
            end
          end
        end
      end
    end
  ensure
    ENV["FOLDING_BACKEND_DEPLOYMENT_RECEIPT"] = original_path
    ENV["FOLDING_RELEASE_POLICY_TOKEN"] = original_token
  end

  def test_app_docs_and_xcode_pin_changes_do_not_redeploy_unchanged_backend_inputs
    Dir.mktmpdir("folding-backend-inputs") do |directory|
      original = FoldingRelease::ROOT
      FoldingRelease.send(:remove_const, :ROOT)
      FoldingRelease.const_set(:ROOT, directory)
      begin
        git = ->(*args) do
          Open3
            .capture3("git", *args, chdir: directory)
            .then do |out, error, status|
              raise error unless status.success?
              out.strip
            end
        end
        git.call("init", "-q")
        git.call("config", "user.name", "Backend input test")
        git.call("config", "user.email", "test@example.invalid")
        git.call("config", "commit.gpgsign", "false")
        write =
          lambda do |name, contents|
            path = File.join(directory, name)
            FileUtils.mkdir_p(File.dirname(path))
            File.write(path, contents)
          end
        commit = -> do
          git.call("add", ".")
          git.call("commit", "-qm", "Fixture source")
          git.call("rev-parse", "HEAD")
        end
        write.call("backend/Cargo.toml", "workspace")
        write.call("backend/crates/worker/src/lib.rs", "backend source")
        write.call(
          "tool-versions.json",
          JSON.generate(
            { "rust" => "1.99.1", "xcode" => { "version" => "27.2" } }
          )
        )
        legacy = commit.call
        expected = FoldingRelease.backend_input_hash(legacy)
        FileUtils.mkdir_p(File.join(directory, "apps/folding"))
        git.call("mv", "backend", "tool-versions.json", "apps/folding/")
        moved = commit.call
        FoldingRelease.send(:remove_const, :ROOT)
        FoldingRelease.const_set(:ROOT, File.join(directory, "apps/folding"))
        assert_equal expected, FoldingRelease.backend_input_hash(moved)
        write.call("apps/folding/apps/ios/App/Screen.swift", "native change")
        write.call(
          "apps/folding/backend/crates/worker/README.md",
          "documentation change"
        )
        write.call(
          "apps/folding/tool-versions.json",
          JSON.generate(
            { "rust" => "1.99.1", "xcode" => { "version" => "28.0" } }
          )
        )
        client = commit.call
        assert_equal expected, FoldingRelease.backend_input_hash(client)
        write.call("apps/folding/backend/bun.lock", "changed test dependency")
        write.call("apps/folding/backend/package.json", "changed test tools")
        write.call(
          "apps/folding/scripts/generate-worker-config.py",
          "changed configuration generator"
        )
        write.call(
          "apps/folding/backend/tool-versions.json",
          JSON.generate({ "rust" => "1.99.1", "worker_build" => "0.8.7" })
        )
        write.call(
          "apps/folding/tool-versions.json",
          JSON.generate({ "xcode" => { "version" => "28.0" } })
        )
        tooling = commit.call
        assert_equal expected, FoldingRelease.backend_input_hash(tooling)
        write.call(
          "apps/folding/backend/tool-versions.json",
          JSON.generate({ "rust" => "1.100.0", "worker_build" => "0.8.7" })
        )
        compiler = commit.call
        refute_equal expected, FoldingRelease.backend_input_hash(compiler)
        write.call(
          "apps/folding/backend/tool-versions.json",
          JSON.generate({ "rust" => "1.99.1", "worker_build" => "0.8.7" })
        )
        write.call(
          "apps/folding/backend/crates/worker/src/lib.rs",
          "changed backend source"
        )
        changed = commit.call
        refute_equal expected, FoldingRelease.backend_input_hash(changed)
      ensure
        FoldingRelease.send(:remove_const, :ROOT)
        FoldingRelease.const_set(:ROOT, original)
      end
    end
  end

  def test_ci_evidence_requires_trusted_main_push_and_exact_attempt
    source = "a" * 40
    base = {
      "head_sha" => source,
      "path" => ".github/workflows/ci.yml",
      "status" => "completed",
      "conclusion" => "success",
      "run_attempt" => 2,
      "event" => "push",
      "head_branch" => "main",
      "head_repository" => {
        "full_name" => "0x63616c/world-wide-webb"
      }
    }
    check = {
      "kind" => "ci",
      "name" => "backend",
      "commit_sha" => source,
      "conclusion" => "success",
      "run_url" =>
        "https://github.com/0x63616c/world-wide-webb/actions/runs/1/attempts/2"
    }
    [
      { "event" => "pull_request" },
      { "head_branch" => "feature" },
      { "run_attempt" => 3 },
      { "head_repository" => { "full_name" => "other/repo" } },
      {}
    ].each do |change|
      run = base.merge(change)
      command =
        lambda do |*args|
          unless args.last.include?("jobs?")
            assert_equal "repos/0x63616c/world-wide-webb/actions/runs/1/attempts/2",
                         args.last
          end
          if args.last.include?("jobs?")
            JSON.generate(
              [
                {
                  "jobs" => [
                    {
                      "name" => "Folding / Folding backend",
                      "head_sha" => source,
                      "status" => "completed",
                      "conclusion" => "success"
                    }
                  ]
                }
              ]
            )
          else
            JSON.generate(run)
          end
        end
      FoldingRelease.stub(:run, command) do
        if change.empty?
          FoldingRelease::CheckEvidence.validate!(
            check,
            source: source,
            base: "."
          )
        else
          assert_raises(
            RuntimeError
          ) { FoldingRelease::CheckEvidence.validate!(check, source: source, base: ".") }
        end
      end
    end
  end
end
