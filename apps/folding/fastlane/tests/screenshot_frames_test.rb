require "minitest/autorun"
require "tmpdir"
require "zlib"
require "json"
require "open3"
require "deliver/app_screenshot"

class ScreenshotFramesTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)

  def chunk(kind, bytes)
    [bytes.bytesize].pack("N") + kind + bytes + [Zlib.crc32(kind + bytes)].pack("N")
  end

  def test_all_localized_copy_renders_opaque_and_deliver_recognizes_every_upload_slot
    plan = JSON.parse(File.read(File.join(ROOT, "fastlane/screenshot-plan.json")))
    source = JSON.parse(File.read(File.join(ROOT, "fastlane/metadata-source.json")))
    Dir.mktmpdir("folding-frame-test-") do |directory|
      renderer = File.join(directory, "compose")
      output, status = Open3.capture2e("swiftc", File.join(ROOT, "fastlane/scripts/compose-screenshot.swift"), "-o", renderer)
      assert status.success?, output
      # Synthetic rectangular source, deliberately unlike an app/store asset.
      raw = File.join(directory, "fixture.png")
      bytes = "\x89PNG\r\n\x1a\n".b + chunk("IHDR", [100, 150, 8, 2, 0, 0, 0].pack("NNCCCCC"))
      pixels = 150.times.map { |y| "\0".b + [y, 120, 220].pack("CCC") * 100 }.join
      File.binwrite(raw, bytes + chunk("IDAT", Zlib.deflate(pixels)) + chunk("IEND", ""))
      displays = plan.fetch("devices") + [plan.fetch("additional_upload_slots").first]
      source.fetch("locales").each do |locale, copy|
        plan.fetch("scenarios").each do |scene|
          displays.each do |display|
            path = File.join(directory, "#{locale}-#{scene.fetch('id')}-#{display.fetch('id')}.png")
            output, status = Open3.capture2e(renderer, raw, path,
              display.fetch("pixel_width").to_s, display.fetch("pixel_height").to_s,
              copy.fetch("captions").fetch(scene.fetch("id")), copy.fetch("eyebrows").fetch(scene.fetch("id")),
              scene.fetch("appearance"), File.join(ROOT, "fastlane/screenshot-frame.json"))
            assert status.success?, "#{locale}/#{scene['id']}: #{output}"
            assert_equal 2, File.binread(path, 26).getbyte(25), "Expected RGB PNG without alpha"
            assert_equal display.fetch("upload_display_type"), Deliver::AppScreenshot.calculate_display_type(path)
          end
        end
      end
    end
  end
end
