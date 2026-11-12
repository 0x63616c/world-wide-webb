require "minitest/autorun"
require_relative "../lib/tip_products"

class AppAvailabilityTest < Minitest::Test
  class Apple
    attr_accessor :future, :exists, :ignore_writes, :catalog
    attr_reader :writes, :rows

    def initialize
      @future = true
      @exists = true
      @catalog = %w[AFG GBR MAR USA]
      @writes = []
      @rows =
        @catalog.map do |country|
          {
            "id" => "apple-#{country}",
            "attributes" => {
              "available" => true,
              "releaseDate" => "2026-11-11"
            },
            "relationships" => {
              "territory" => {
                "data" => {
                  "id" => country
                }
              }
            }
          }
        end
    end

    def request(method, path, body: nil, **)
      if method == "GET"
        if path == "/v1/apps/6832059501"
          return(
            {
              "data" => {
                "attributes" => {
                  "bundleId" => "app.getfolding.Folding"
                }
              }
            }
          )
        end
        return(
          (
            if exists
              {
                "data" => {
                  "id" => "availability",
                  "attributes" => {
                    "availableInNewTerritories" => future
                  }
                }
              }
            else
              nil
            end
          )
        )
      end
      @writes << [method, path, body]
      return {} if ignore_writes
      if method == "PATCH"
        row =
          rows.find do |item|
            path == "/v1/territoryAvailabilities/#{item.fetch("id")}"
          end || raise("Wrong Apple resource ID")
        row.fetch("attributes")["available"] = body.dig(
          "data",
          "attributes",
          "available"
        )
      else
        @exists = true
        @future = body.dig("data", "attributes", "availableInNewTerritories")
        selected =
          body
            .dig("data", "relationships", "territoryAvailabilities", "data")
            .map { |item| item.fetch("id") }
        @rows.each do |row|
          country = row.dig("relationships", "territory", "data", "id")
          row.fetch("attributes")["available"] = selected.include?(
            row.fetch("id")
          ) || selected.include?("${folding-#{country}}")
        end
      end
      {}
    end

    def all(path)
      if path == "/v1/territories?limit=200"
        return catalog.map { |id| { "id" => id } }
      end
      exists ? rows : []
    end
  end

  def reconcile(api)
    FoldingRelease.stub(:atomic_json, nil) do
      capture_io do
        @report = FoldingTipProducts.configure_app_availability(api: api)
      end
    end
    @report
  end

  def test_removes_excluded_countries_preserves_dates_and_is_idempotent
    api = Apple.new
    report = reconcile(api)
    assert_equal %w[GBR USA], report.fetch("selected_territories")
    assert_equal %w[
                   /v1/territoryAvailabilities/apple-AFG
                   /v1/territoryAvailabilities/apple-MAR
                 ],
                 api.writes.map { |write| write[1] }
    assert api.rows.all? { |row|
             row.dig("attributes", "releaseDate") == "2026-11-11"
           }
    api.writes.clear
    reconcile(api)
    assert_empty api.writes
  end

  def test_restores_allowed_countries_and_includes_new_apple_territories
    api = Apple.new
    api.rows.last.fetch("attributes")["available"] = false
    api.catalog << "CAN"
    api.rows << {
      "id" => "apple-CAN",
      "attributes" => {
        "available" => false
      },
      "relationships" => {
        "territory" => {
          "data" => {
            "id" => "CAN"
          }
        }
      }
    }
    assert_equal %w[CAN GBR USA], reconcile(api).fetch("selected_territories")
  end

  def test_bootstraps_missing_availability_and_reconciles_future_setting
    api = Apple.new
    api.exists = false
    assert reconcile(api).fetch("created")
    assert_equal "POST", api.writes.last.first
    api.writes.clear
    api.future = false
    reconcile(api)
    assert api.future
    assert_equal ["POST"], api.writes.map(&:first)
  end

  def test_unknown_country_and_failed_readback_are_errors
    api = Apple.new
    api.catalog.delete("MAR")
    assert_raises(FastlaneCore::Interface::FastlaneError) { reconcile(api) }
    assert_empty api.writes
    api = Apple.new
    api.ignore_writes = true
    assert_raises(FastlaneCore::Interface::FastlaneError) { reconcile(api) }
  end

  def test_committed_policy_rejects_typo_in_country_code
    policy =
      File.read(
        File.join(FoldingRelease::ROOT, "fastlane/app-availability.json")
      )
    File.stub(:read, policy.sub('"AFG"', '"afg"')) do
      assert_raises(FoldingTipProducts::DiagnosticError) do
        FoldingTipProducts.app_availability_policy
      end
    end
  end
end
