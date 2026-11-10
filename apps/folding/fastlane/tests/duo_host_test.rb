require "minitest/autorun"
require_relative "../../../../scripts/duo-host"
require "tmpdir"

class DuoHostTest < Minitest::Test
  def test_native_build_diagnostics_cannot_inherit_provider_credentials
    names = %w[ASC_PRIVATE_KEY GH_TOKEN MATCH_PASSWORD MATCH_GIT_BASIC_AUTHORIZATION]
    previous = names.to_h { |name| [name, ENV[name]] }
    names.each { |name| ENV[name] = "synthetic-credential" }
    Dir.mktmpdir do |directory|
      host = DuoHost.new(directory: directory, device_name: "Owned fixture", device_id: "00000000-0000-4000-8000-000000000001")
      host.send(:run, "ruby", "-e", 'puts %w[ASC_PRIVATE_KEY GH_TOKEN MATCH_PASSWORD MATCH_GIT_BASIC_AUTHORIZATION].any? { |name| ENV.key?(name) }; puts ENV.key?("PATH")')
      assert_equal "false\ntrue\n", File.read(File.join(directory, "build.log"))
    end
  ensure
    previous&.each { |name, value| ENV[name] = value }
  end
end
