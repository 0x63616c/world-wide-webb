#!/usr/bin/env ruby
require_relative "../fastlane/lib/backend_delivery"
require "yaml"

begin
  case ARGV.fetch(0)
  when "backend"
    FoldingRelease::BackendDelivery.deploy(run_url: ENV.fetch("FOLDING_SOURCE_CI_RUN_URL"))
  when "receipt"
    path = FoldingRelease::BackendDelivery.download(ENV.fetch("RUNNER_TEMP"))
    File.open(ENV.fetch("GITHUB_ENV"), "a") { |file| file.puts("FOLDING_BACKEND_DEPLOYMENT_RECEIPT=#{path}") }
  when "native-needed"
    config = YAML.safe_load(File.read(File.join(FoldingRelease::ROOT, "app.yml")))
    needed = FoldingRelease::BackendDelivery.native_needed?(include_submission: config["app_store_automatic"] == true)
    File.open(ENV.fetch("GITHUB_OUTPUT"), "a") { |file| file.puts("beta=#{needed}") }
  when "evidence"
    source = FoldingRelease.clean_commit!
    checks = %w[contracts domain-storage simulator localization].map do |name|
      {"kind" => "ci", "name" => name, "commit_sha" => source, "conclusion" => "success", "run_url" => ENV.fetch("FOLDING_SOURCE_CI_RUN_URL")}
    end
    path = File.join(ENV.fetch("RUNNER_TEMP"), "folding-beta-checks.json")
    FoldingRelease.atomic_json(path, {"commit_sha" => source, "required_checks" => checks})
    File.open(ENV.fetch("GITHUB_ENV"), "a") { |file| file.puts("FOLDING_BETA_EVIDENCE=#{path}") }
  else
    raise "Unknown Folding delivery operation"
  end
rescue StandardError => error
  warn "Folding delivery stopped (#{error.class}); reconcile provider state before retrying. Provider payloads and credentials are suppressed."
  exit 1
end
