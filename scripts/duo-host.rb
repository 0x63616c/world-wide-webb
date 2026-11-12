require "fileutils"
require "json"
require "open3"
require "securerandom"

# Owns one Device Hub process and scoped XCTest controller. Product tests remain
# responsible for checking the resulting native geometry and capture contents.
class DuoHost
  def initialize(directory:, device_name:, device_id:)
    @directory = File.expand_path(directory)
    @device_name = device_name
    @device_id = device_id
    @processes = []
    @logs = []
  end

  def start
    raise "Device Hub is already running; use an isolated capture session" if system("pgrep", "-x", "DeviceHub", out: File::NULL)
    FileUtils.mkdir_p(@directory)
    stage("generating_host")
    project = File.join(@directory, "host-project")
    raise "Controller output already exists; use a fresh capture directory" if File.exist?(project)
    FileUtils.cp_r(File.join(__dir__, "duo-host-control"), project)
    run("xcodegen", "generate", "--quiet", chdir: project)
    @project = File.join(project, "DuoCaptureHost.xcodeproj")
    @derived = File.join(@directory, "HostDerivedData")
    stage("building_host")
    run("xcodebuild", "build-for-testing", *build_arguments, "-quiet")
    runner = File.join(@derived, "Build/Products/Debug/DuoHostControlTests-Runner.app")
    entitlements, _error, status = Open3.capture3("codesign", "-d", "--entitlements", ":-", runner)
    raise "Cannot inspect native controller sandbox" unless status.success?
    json, _error, status = Open3.capture3("plutil", "-convert", "json", "-o", "-", "-", stdin_data: entitlements)
    grants = status.success? && JSON.parse(json)
    raise "Controller must retain its scoped sandbox" unless grants && grants["com.apple.security.app-sandbox"] == true &&
      grants["com.apple.security.temporary-exception.files.absolute-path.read-write"] == [@directory + "/"]
    developer = ENV["DEVELOPER_DIR"] || Open3.capture2("xcode-select", "-p").first.strip
    application = File.expand_path("../Applications/DeviceHub.app", developer)
    stage("launching_hub")
    app = spawn({}, File.join(application, "Contents/MacOS/DeviceHub"), log: "application.log")
    environment = {"TEST_RUNNER_DUO_HOST_APPLICATION_PATH" => application,
      "TEST_RUNNER_DUO_HOST_APPLICATION_PID" => app.to_s, "TEST_RUNNER_DUO_HOST_CONTROL_DIR" => @directory,
      "TEST_RUNNER_DUO_HOST_DEVICE_NAME" => @device_name,
      "TEST_RUNNER_DUO_HOST_DEVICE_ID" => @device_id}
    stage("starting_controller")
    spawn(environment, "xcodebuild", "test-without-building", *build_arguments,
      "-parallel-testing-enabled", "NO", "-test-timeouts-enabled", "NO",
      "-resultBundlePath", File.join(@directory, "HostControl.xcresult"), log: "controller.log")
    wait_until(120) { File.exist?(File.join(@directory, "host-ready")) }
    self
  rescue StandardError
    close
    raise
  end

  def pose(value)
    raise "Unknown native Duo pose" unless %w[inner outer].include?(value)
    identifier = SecureRandom.hex(12)
    temporary = File.join(@directory, "host-request.tmp")
    File.write(temporary, JSON.generate({"id" => identifier, "pose" => value}))
    File.rename(temporary, File.join(@directory, "host-request.json"))
    wait_until(60) do
      response = File.join(@directory, "host-response.json")
      payload = File.exist?(response) && JSON.parse(File.read(response))
      payload && payload["id"] == identifier && payload["ok"] == true
    end
  end

  # Reuse Tendr's enumerated-display capture bridge. XCUIScreen can expose only
  # the inactive outer framebuffer while the app occupies Duo's inner display.
  def capture_bridge(output:)
    tool = File.join(__dir__, "duo-simulator.py")
    FileUtils.mkdir_p(output)
    run("python3", tool, "probe", @device_id, @directory)
    run("python3", tool, "configure-host", @device_id, @directory)
    spawn({}, "python3", tool, "serve", @device_id, @directory,
      "--output", output, "--appearance", "light", log: "capture.log")
  end

  def close
    FileUtils.touch(File.join(@directory, "host-stop")) if File.directory?(@directory)
    @processes.reverse_each do |pid|
      Process.kill("TERM", -pid)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 5
      loop do
        break if Process.waitpid(pid, Process::WNOHANG)
        if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
          Process.kill("KILL", -pid)
          Process.waitpid(pid)
          break
        end
        sleep 0.1
      end
    rescue Errno::ESRCH, Errno::ECHILD
      next
    end
    @processes.clear
    @logs.each(&:close)
    @logs.clear
  end

  private

  def stage(value)
    File.open(File.join(@directory, "host-stage.txt"), "w", 0o600) { |file| file.puts(value) }
    puts JSON.generate({"event" => "native_capture", "stage" => value})
    $stdout.flush
  end

  def build_arguments
    ["-project", @project, "-scheme", "DuoCaptureHost", "-destination", "platform=macOS",
      "-derivedDataPath", @derived, "DUO_HOST_CONTROL_DIRECTORY=#{@directory}"]
  end

  def run(*arguments, chdir: @directory)
    File.open(File.join(@directory, "build.log"), "ab", 0o600) do |log|
      raise "Native controller build failed; inspect #{@directory}/build.log" unless system(capture_environment, *arguments, chdir: chdir, out: log, err: log)
    end
  end

  def spawn(environment, *arguments, log:)
    output = File.open(File.join(@directory, log), "wb", 0o600)
    @logs << output
    pid = Process.spawn(environment.merge(capture_environment), *arguments, out: output, err: output, pgroup: true)
    @processes << pid
    pid
  end

  def wait_until(timeout)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
    loop do
      raise "Native controller exited; inspect #{@directory}" if @processes.any? { |pid| Process.waitpid(pid, Process::WNOHANG) }
      return if yield
      if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        path = File.join(@directory, "host-stage.txt")
        stage = File.file?(path) ? File.read(path).strip : "test_runner_startup"
        raise "Native controller timed out at #{stage}; inspect #{@directory}"
      end
      sleep 0.25
    end
  end

  def capture_environment
    ENV.keys.grep(/TOKEN|PASSWORD|SECRET|PRIVATE_KEY|AUTHORIZATION|\AASC_(KEY_ID|ISSUER_ID)\z/).to_h { |key| [key, nil] }
  end
end
