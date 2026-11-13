require "rbconfig"

module FoldingRelease
  module CheckEvidence
    COMMANDS = {
      "contracts" => [
        %w[.venv/contracts/bin/python scripts/check-contracts.py]
      ],
      "domain-storage" => [
        %w[swift test --package-path apps/ios/Packages/FoldingKit]
      ],
      "backend" => [["scripts/check-backend"]],
      "native-build" => [
        [
          "xcodebuild",
          "-project",
          "apps/ios/Folding.xcodeproj",
          "-scheme",
          "Folding",
          "-destination",
          "generic/platform=iOS Simulator",
          "CODE_SIGNING_ALLOWED=NO",
          "build"
        ]
      ],
      "localization" => [
        %w[python3 scripts/check-localization.py],
        %w[python3 scripts/test-localization.py]
      ],
      "screenshots" => [
        %w[bundle exec fastlane ios screenshots environment:production]
      ]
    }.freeze
    # Exact workflow path + job display name; an unrelated green job cannot satisfy a gate.
    CI_JOBS = {
      "contracts" => [
        ".github/workflows/ci.yml",
        "Folding / Folding contracts"
      ],
      "domain-storage" => [
        ".github/workflows/ci.yml",
        "Folding / Folding domain and storage"
      ],
      "backend" => [".github/workflows/ci.yml", "Folding / Folding backend"],
      "native-build" => [
        ".github/workflows/ci.yml",
        "Folding / Folding native"
      ],
      "localization" => [
        ".github/workflows/ci.yml",
        "Folding / Folding localization"
      ],
      "screenshots" => [
        ".github/workflows/folding-store-checks.yml",
        "Folding App Store screenshots"
      ]
    }.freeze

    def self.capture(name:, directory:)
      commands =
        COMMANDS.fetch(name) { raise "No executable local check: #{name}" }
      source = FoldingRelease.clean_commit!
      FileUtils.mkdir_p(directory)
      started = Time.now.utc.iso8601
      logs = []
      commands.each_with_index do |arguments, index|
        log =
          File.join(
            directory,
            "#{name}-#{source}-#{index}-#{SecureRandom.hex(6)}.log"
          )
        status =
          File.open(log, "wb", 0o600) do |output|
            pid =
              Process.spawn(*arguments, chdir: ROOT, out: output, err: output)
            Process.wait2(pid).last
          end
        logs << {
          "name" => File.basename(log),
          "sha256" => FoldingRelease.sha(log),
          "exit_status" => status.exitstatus
        }
        raise "Local #{name} failed; inspect #{log}" unless status.success?
      end
      unless FoldingRelease.clean_commit! == source
        raise "Source changed during check"
      end
      result = {
        "kind" => "local",
        "name" => name,
        "commit_sha" => source,
        "commands" => commands,
        "conclusion" => "success",
        "started_at" => started,
        "finished_at" => Time.now.utc.iso8601,
        "host" => RbConfig::CONFIG.fetch("host"),
        "toolchain_manifest_sha256" =>
          FoldingRelease.sha(File.join(ROOT, "tool-versions.json")),
        "logs" => logs
      }
      path =
        File.join(directory, "#{name}-#{source}-#{SecureRandom.hex(6)}.json")
      FoldingRelease.atomic_json(path, result)
      {
        "name" => name,
        "kind" => "local",
        "commit_sha" => source,
        "conclusion" => "success",
        "evidence_path" => File.expand_path(path),
        "evidence_sha256" => FoldingRelease.sha(path)
      }
    end

    def self.validate!(check, source:, base:)
      name = check.fetch("name")
      unless check["conclusion"] == "success" && check["commit_sha"] == source
        raise "Failed or mismatched check: #{name}"
      end
      if check["kind"] == "local"
        path = File.expand_path(check.fetch("evidence_path"), base)
        unless FoldingRelease.sha(path) == check.fetch("evidence_sha256")
          raise "Local evidence hash changed"
        end
        evidence = FoldingRelease.read_json(path)
        unless evidence.values_at("name", "commit_sha", "conclusion", "kind") ==
                 [name, source, "success", "local"]
          raise "Local evidence identity differs"
        end
        unless evidence.fetch("commands") == COMMANDS.fetch(name)
          raise "Unexpected local command"
        end
        unless evidence.fetch("toolchain_manifest_sha256") ==
                 FoldingRelease.sha(File.join(ROOT, "tool-versions.json"))
          raise "Toolchain pins changed"
        end
        unless Time.iso8601(evidence.fetch("finished_at")) >=
                 Time.iso8601(evidence.fetch("started_at"))
          raise "Invalid check timing"
        end
        logs = evidence.fetch("logs")
        unless logs.length == COMMANDS.fetch(name).length
          raise "Missing command output"
        end
        logs.each do |log|
          filename = log.fetch("name")
          unless filename == File.basename(filename)
            raise "Invalid output filename"
          end
          unless log["exit_status"] == 0 &&
                   FoldingRelease.sha(
                     File.join(File.dirname(path), filename)
                   ) == log.fetch("sha256")
            raise "Failed or changed command output"
          end
        end
      elsif check["kind"] == "review" && name == "final-review"
        path = File.expand_path(check.fetch("evidence_path"), base)
        unless FoldingRelease.sha(path) == check.fetch("evidence_sha256")
          raise "Review evidence hash changed"
        end
        review = FoldingRelease.read_json(path)
        unless review["commit_sha"] == source &&
                 review["state"] == "approved" &&
                 !review["reviewer"].to_s.strip.empty? &&
                 review["findings"] == []
          raise "Review not approved for this source"
        end
      else
        raise "Unknown check evidence kind" unless check["kind"] == "ci"
        workflow, job_name =
          CI_JOBS.fetch(name) do
            raise "No trusted CI job configured for #{name}; use local evidence"
          end
        match =
          check.fetch("run_url").match(
            %r{\Ahttps://github\.com/#{Regexp.escape(CONFIG.fetch("repository"))}/actions/runs/(\d+)(?:/attempts/(\d+))?/?\z}
          )
        raise "Expected exact Actions run URL" unless match
        prefix = "repos/#{CONFIG.fetch("repository")}/actions/runs/#{match[1]}"
        attempt = match[2] ? "#{prefix}/attempts/#{match[2]}" : prefix
        run = JSON.parse(FoldingRelease.run("gh", "api", attempt))
        trusted_event = %w[push workflow_dispatch].include?(run["event"])
        unless run["head_sha"] == source && run["path"] == workflow &&
                 run["status"] == "completed" &&
                 run["conclusion"] == "success" && trusted_event &&
                 run["head_branch"] == "main" &&
                 run.dig("head_repository", "full_name") ==
                   CONFIG.fetch("repository") &&
                 run["run_attempt"].is_a?(Integer) && run["run_attempt"] > 0 &&
                 (!match[2] || match[2].to_i == run["run_attempt"])
          raise "Wrong workflow/source or unsuccessful run"
        end
        pages =
          JSON.parse(
            FoldingRelease.run(
              "gh",
              "api",
              "--paginate",
              "--slurp",
              "#{prefix}/attempts/#{run.fetch("run_attempt")}/jobs?per_page=100"
            )
          )
        jobs =
          pages
            .flat_map { |page| page.fetch("jobs") }
            .select { |job| job["name"] == job_name }
        unless jobs.length == 1 && jobs.first["head_sha"] == source &&
                 jobs.first["status"] == "completed" &&
                 jobs.first["conclusion"] == "success"
          raise "Named job missing, ambiguous or failed"
        end
      end
    end
  end
end
