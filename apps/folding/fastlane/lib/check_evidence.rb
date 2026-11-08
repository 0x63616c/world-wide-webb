require "rbconfig"

module FoldingRelease
  module CheckEvidence
    COMMANDS = {
      "contracts" => [[".venv/contracts/bin/python", "scripts/check-contracts.py"]],
      "domain-storage" => [["swift", "test", "--package-path", "apps/ios/Packages/FoldingKit"]],
      "backend" => [["scripts/check-backend"]],
      "simulator" => [["bundle", "exec", "fastlane", "ios", "verify_app"]],
      "localization" => [["python3", "scripts/check-localization.py"], ["python3", "scripts/test-localization.py"]],
      "screenshots" => [["bundle", "exec", "fastlane", "ios", "screenshots", "environment:production"]]
    }.freeze
    # Exact workflow path + job display name; an unrelated green job cannot satisfy a gate.
    CI_JOBS = {"contracts" => [".github/workflows/checks.yml", "Contract schemas and fixtures"]}.freeze

    def self.capture(name:, directory:)
      commands = COMMANDS.fetch(name) { raise "No executable local check: #{name}" }
      source = FoldingRelease.clean_commit!
      FileUtils.mkdir_p(directory)
      started = Time.now.utc.iso8601
      logs = []
      commands.each_with_index do |arguments, index|
        log = File.join(directory, "#{name}-#{source}-#{index}-#{SecureRandom.hex(6)}.log")
        status = File.open(log, "wb", 0o600) do |output|
          pid = Process.spawn(*arguments, chdir: ROOT, out: output, err: output)
          Process.wait2(pid).last
        end
        logs << {"name" => File.basename(log), "sha256" => FoldingRelease.sha(log), "exit_status" => status.exitstatus}
        raise "Local #{name} failed; inspect #{log}" unless status.success?
      end
      raise "Source changed during check" unless FoldingRelease.clean_commit! == source
      result = {"kind" => "local", "name" => name, "commit_sha" => source, "commands" => commands,
        "conclusion" => "success", "started_at" => started, "finished_at" => Time.now.utc.iso8601,
        "host" => RbConfig::CONFIG.fetch("host"), "toolchain_manifest_sha256" => FoldingRelease.sha(File.join(ROOT, "tool-versions.json")),
        "logs" => logs}
      path = File.join(directory, "#{name}-#{source}-#{SecureRandom.hex(6)}.json")
      FoldingRelease.atomic_json(path, result)
      {"name" => name, "kind" => "local", "commit_sha" => source, "conclusion" => "success",
        "evidence_path" => File.expand_path(path), "evidence_sha256" => FoldingRelease.sha(path)}
    end

    def self.validate!(check, source:, base:)
      name = check.fetch("name")
      raise "Failed or mismatched check: #{name}" unless check["conclusion"] == "success" && check["commit_sha"] == source
      if check["kind"] == "local"
        path = File.expand_path(check.fetch("evidence_path"), base)
        raise "Local evidence hash changed" unless FoldingRelease.sha(path) == check.fetch("evidence_sha256")
        evidence = FoldingRelease.read_json(path)
        raise "Local evidence identity differs" unless evidence.values_at("name", "commit_sha", "conclusion", "kind") == [name, source, "success", "local"]
        raise "Unexpected local command" unless evidence.fetch("commands") == COMMANDS.fetch(name)
        raise "Toolchain pins changed" unless evidence.fetch("toolchain_manifest_sha256") == FoldingRelease.sha(File.join(ROOT, "tool-versions.json"))
        raise "Invalid check timing" unless Time.iso8601(evidence.fetch("finished_at")) >= Time.iso8601(evidence.fetch("started_at"))
        logs = evidence.fetch("logs")
        raise "Missing command output" unless logs.length == COMMANDS.fetch(name).length
        logs.each do |log|
          filename = log.fetch("name")
          raise "Invalid output filename" unless filename == File.basename(filename)
          raise "Failed or changed command output" unless log["exit_status"] == 0 && FoldingRelease.sha(File.join(File.dirname(path), filename)) == log.fetch("sha256")
        end
      elsif check["kind"] == "review" && name == "final-review"
        path = File.expand_path(check.fetch("evidence_path"), base)
        raise "Review evidence hash changed" unless FoldingRelease.sha(path) == check.fetch("evidence_sha256")
        review = FoldingRelease.read_json(path)
        raise "Review not approved for this source" unless review["commit_sha"] == source && review["state"] == "approved" && !review["reviewer"].to_s.strip.empty? && review["findings"] == []
      else
        workflow, job_name = CI_JOBS.fetch(name) { raise "No trusted CI job configured for #{name}; use local evidence" }
        match = check.fetch("run_url").match(%r{\Ahttps://github\.com/#{Regexp.escape(CONFIG.fetch("repository"))}/actions/runs/(\d+)(?:/attempts/\d+)?/?\z})
        raise "Expected exact Actions run URL" unless match
        prefix = "repos/#{CONFIG.fetch('repository')}/actions/runs/#{match[1]}"
        run = JSON.parse(FoldingRelease.run("gh", "api", prefix))
        raise "Wrong workflow/source or unsuccessful run" unless run["head_sha"] == source && run["path"] == workflow && run["status"] == "completed" && run["conclusion"] == "success"
        pages = JSON.parse(FoldingRelease.run("gh", "api", "--paginate", "--slurp", "#{prefix}/attempts/#{run.fetch('run_attempt')}/jobs?per_page=100"))
        jobs = pages.flat_map { |page| page.fetch("jobs") }.select { |job| job["name"] == job_name }
        raise "Named job missing, ambiguous or failed" unless jobs.length == 1 && jobs.first["head_sha"] == source && jobs.first["status"] == "completed" && jobs.first["conclusion"] == "success"
      end
    end
  end
end
