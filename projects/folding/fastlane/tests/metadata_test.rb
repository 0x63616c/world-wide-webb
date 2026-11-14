require "minitest/autorun"
require_relative "../lib/release_assets"

class MetadataTest < Minitest::Test
  def test_storefront_metadata_matches_source_and_apple_name_keyword_rules
    FoldingRelease::Assets.validate_metadata!

    locales = FoldingRelease::Assets::SOURCE.fetch("locales")
    assert_equal "Folding: Fold Tracker & Ranks", locales.fetch("en-US").fetch("name")
    ranks = {
      "en-US" => /Ranks/,
      "de-DE" => /Ranking|Rangliste|\bRang\b/,
      "fr-FR" => /classement|rangs/i,
      "es-ES" => /ranking|clasificaci/i,
      "es-MX" => /ranking|clasificaci/i,
      "ja" => /ランキング|順位/,
      "ko" => /순위/,
      "pt-BR" => /ranking/i,
      "zh-Hans" => /排行/,
      "zh-Hant" => /排行/
    }
    locales.each do |locale, fields|
      name = fields.fetch("name")
      assert_operator name.length, :<=, 30, locale
      assert_match ranks.fetch(locale), name, locale
      assert_operator fields.fetch("keywords").length, :<=, 100, locale
      refute fields.fetch("keywords").split(",").any? { |word| word.strip.casecmp("duo").zero? }, locale
      assert_equal 1, fields.fetch("description").scan(/iPhone Duo/i).length, locale
    end
  end
end
