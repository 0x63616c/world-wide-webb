require "minitest/autorun"
require_relative "../lib/release_assets"

class MetadataTest < Minitest::Test
  def test_storefront_metadata_matches_source_and_apple_name_keyword_rules
    assert_nil FoldingRelease::Assets.validate_metadata!

    locales = FoldingRelease::Assets::SOURCE.fetch("locales")
    assert_equal "Folding: Fold Tracker & Ranks", locales.fetch("en-US").fetch("name")
    locales.each do |locale, fields|
      assert_operator fields.fetch("name").length, :<=, 30, locale
      assert_operator fields.fetch("keywords").length, :<=, 100, locale
      refute fields.fetch("keywords").split(",").any? { |word| word.strip.casecmp("duo").zero? }, locale
      assert_equal 1, fields.fetch("description").scan(/iPhone Duo/i).length, locale
    end
  end
end
