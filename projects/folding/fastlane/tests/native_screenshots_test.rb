require "minitest/autorun"
require "tmpdir"
require "zlib"
require_relative "../lib/release_assets"

class NativeScreenshotsTest < Minitest::Test
  def chunk(kind, bytes)
    [bytes.bytesize].pack("N") + kind + bytes +
      [Zlib.crc32(kind + bytes)].pack("N")
  end

  def png(path, width, height)
    rows =
      height
        .times
        .map { |y| "\0".b + [y % 256, 120, 220].pack("CCC") * width }
        .join
    File.binwrite(
      path,
      "\x89PNG\r\n\x1a\n".b +
        chunk("IHDR", [width, height, 8, 2, 0, 0, 0].pack("NNCCCCC")) +
        chunk("IDAT", Zlib.deflate(rows)) + chunk("IEND", "")
    )
  end

  def test_store_image_preserves_actual_screen_pixels
    Dir.mktmpdir do |directory|
      display = FoldingRelease::Assets::PLAN.fetch("devices").first
      scene = FoldingRelease::Assets::PLAN.fetch("scenarios").first
      locale = FoldingRelease::Assets::LOCALES.first
      raw = File.join(directory, "screen.png")
      png(raw, display.fetch("pixel_width"), display.fetch("pixel_height"))
      record =
        Struct.new(:data, :directory).new(
          { "commit_sha" => "a" * 40, "configuration_hash" => "b" * 64 },
          directory
        )
      entry =
        FoldingRelease::Assets.stage_capture(
          record,
          raw,
          display,
          locale,
          scene
        )
      assert_equal FoldingRelease.sha(raw),
                   FoldingRelease.sha(
                     File.join(
                       directory,
                       "assets",
                       entry.fetch("composed_path")
                     )
                   ),
                   "Store image must be the actual screen PNG, without a frame, crop or resize"
    end
  end
  def test_opaque_alpha_is_removed_without_modifying_the_original_capture
    Dir.mktmpdir do |directory|
      display = FoldingRelease::Assets::PLAN.fetch("devices").first
      raw = File.join(directory, "alpha.png")
      rgba_png(
        raw,
        display.fetch("pixel_width"),
        display.fetch("pixel_height"),
        255
      )
      original = FoldingRelease.sha(raw)
      destination = File.join(directory, "store.png")
      FoldingRelease::Assets.stage_png(raw, destination)
      assert_equal original, FoldingRelease.sha(raw)
      assert_equal 2, File.binread(destination, 26).getbyte(25)
      assert_equal FoldingRelease::Assets.png_size(raw),
                   FoldingRelease::Assets.png_size(destination)
    end
  end

  def test_transparent_screen_cannot_be_silently_flattened
    Dir.mktmpdir do |directory|
      raw = File.join(directory, "transparent.png")
      rgba_png(raw, 2, 3, 128)
      destination = File.join(directory, "store.png")
      assert_raises(RuntimeError) do
        FoldingRelease::Assets.stage_png(raw, destination)
      end
      refute File.exist?(destination)
    end
  end

  def test_a_different_screen_size_is_rejected_instead_of_resized
    Dir.mktmpdir do |directory|
      raw = File.join(directory, "wrong-size.png")
      png(raw, 100, 150)
      record = Struct.new(:data, :directory).new({}, directory)
      assert_raises(RuntimeError) do
        FoldingRelease::Assets.stage_capture(
          record,
          raw,
          FoldingRelease::Assets::PLAN.fetch("devices").first,
          FoldingRelease::Assets::LOCALES.first,
          FoldingRelease::Assets::PLAN.fetch("scenarios").first
        )
      end
    end
  end

  def rgba_png(path, width, height, alpha)
    rows =
      height
        .times
        .map { |y| "\0".b + [y % 256, 120, 220, alpha].pack("CCCC") * width }
        .join
    File.binwrite(
      path,
      "\x89PNG\r\n\x1a\n".b +
        chunk("IHDR", [width, height, 8, 6, 0, 0, 0].pack("NNCCCCC")) +
        chunk("IDAT", Zlib.deflate(rows)) + chunk("IEND", "")
    )
  end

  def test_configured_scenes_resolve_actual_navigation_titles_for_every_locale
    scenes =
      FoldingRelease::Assets::PLAN.fetch("scenarios") +
        FoldingRelease::Assets::PLAN.fetch("review_scenarios")
    FoldingRelease::Assets::LOCALES.each do |locale|
      localized = FoldingRelease::Assets.localized_scenes(scenes, locale)
      assert_equal scenes.map { |scene| scene.fetch("id") },
                   localized.map { |scene| scene.fetch("id") }
      assert localized.all? { |scene| !scene.fetch("title").strip.empty? }
    end
    first =
      FoldingRelease::Assets.localized_scenes(
        scenes,
        { "app_locale" => "en" }
      ).first
    assert_equal "Today", first.fetch("title")
  end

  def test_missing_localized_title_fails_before_capture
    assert_raises(KeyError) do
      FoldingRelease::Assets.localized_scenes(
        [{ "title_key" => "missing.capture.title" }],
        { "app_locale" => "en" }
      )
    end
  end
end
