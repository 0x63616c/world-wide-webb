require "bigdecimal"
require "digest"
require "json"
require "net/http"
require "uri"
require_relative "release_manifest"

# Public App Store Connect OpenAPI 4.6 resources only. Never submits purchases for review.
module FoldingTipProducts
  SOURCE_PATH = File.join(FoldingRelease::ROOT, "fastlane/tip-products.json")
  API_ORIGIN = "https://api.appstoreconnect.apple.com"

  class DiagnosticError < StandardError
  end

  class API
    attr_reader :last_request
    def initialize
      @client = FoldingAppleAccount.client
    end

    def request(method, path, body: nil, missing: false)
      uri = URI.join(API_ORIGIN, path)
      unless uri.scheme == "https" &&
               uri.host == "api.appstoreconnect.apple.com" && uri.port == 443 &&
               uri.userinfo.nil? && uri.path.match?(%r{\A/v[12]/})
        raise DiagnosticError, "Unexpected Apple API origin"
      end
      resources = %w[
        apps
        inAppPurchases
        inAppPurchaseLocalizations
        pricePoints
        iapPriceSchedule
        inAppPurchasePriceSchedules
        manualPrices
        appAvailabilityV2
        appAvailabilities
        territoryAvailabilities
        inAppPurchaseAvailability
        inAppPurchaseAvailabilities
        availableTerritories
        inAppPurchaseAppStoreReviewScreenshots
        appStoreReviewScreenshot
        territories
      ]
      @last_request = {
        "method" => method,
        "resource" =>
          uri
            .path
            .split("/")
            .select { |part| resources.include?(part) }
            .join("/")
      }
      token = @client.token
      token.refresh! if token.expired?
      request = {
        "GET" => Net::HTTP::Get,
        "POST" => Net::HTTP::Post,
        "PATCH" => Net::HTTP::Patch
      }.fetch(method).new(uri)
      request["Authorization"] = "Bearer #{token.text}"
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(body) if body
      response =
        Net::HTTP.start(
          uri.host,
          uri.port,
          use_ssl: true,
          open_timeout: 15,
          read_timeout: 60
        ) { |http| http.request(request) }
      @last_request["http_status"] = response.code.to_i
      return nil if missing && response.code == "404"
      unless response.is_a?(Net::HTTPSuccess)
        # Apple nests actionable submission failures under associatedErrors.
        # Keep codes/pointers, never provider messages containing private values.
        failures = self.class.error_codes(response.body)
        @last_request["errors"] = failures
        raise DiagnosticError,
              "Apple HTTP #{response.code}: #{failures.join("; ")}; reconcile current Apple state before retry"
      end
      JSON.parse(response.body)
    rescue Net::OpenTimeout, Net::ReadTimeout, Timeout::Error
      raise DiagnosticError,
            "Apple request timed out; outcome unknown, rerun to reconcile before mutations",
            cause: nil
    rescue SocketError,
           SystemCallError,
           OpenSSL::SSL::SSLError,
           EOFError,
           IOError
      raise DiagnosticError,
            "Apple transport failed; outcome unknown, rerun to reconcile",
            cause: nil
    rescue JSON::ParserError
      raise DiagnosticError, "Apple returned invalid JSON", cause: nil
    end

    def self.error_codes(body)
      collect =
        lambda do |errors|
          errors.flat_map do |error|
            own = [error["code"], error.dig("source", "pointer")].compact.join(
              " "
            )
            nested = error.dig("meta", "associatedErrors") || {}
            [own, *collect.call(nested.values.flatten)].reject(&:empty?)
          end
        end
      collect.call(JSON.parse(body).fetch("errors", [])).uniq
    rescue JSON::ParserError
      ["invalid_error_response"]
    end

    def all(path)
      rows = []
      visited = []
      while path
        raise DiagnosticError, "Apple pagination loop" if visited.include?(path)
        visited << path
        page = request("GET", path)
        unless page.fetch("data").is_a?(Array)
          raise DiagnosticError, "Expected resource collection"
        end
        rows.concat(page.fetch("data"))
        path = page.fetch("links", {})["next"]
      end
      rows
    end
  end

  def self.source
    value = JSON.parse(File.read(SOURCE_PATH))
    unless value["schema_version"] == 1 &&
             value["app_store_id"] == "6832059501" &&
             value["bundle_id"] == "app.getfolding.Folding"
      raise DiagnosticError, "Wrong tip app"
    end
    products = value.fetch("products")
    unless products.map { |p| p.fetch("product_id") }.sort ==
             FoldingRelease::CONFIG.fetch("tip_product_ids").sort
      raise DiagnosticError, "Wrong tip product set"
    end
    locales =
      FoldingRelease
        .read_json(File.join(FoldingRelease::ROOT, "fastlane/locales.json"))
        .fetch("locales")
        .map { |l| l.fetch("storefront_locale") }
        .sort
    expected_prices = {
      "app.getfolding.Folding.tip.small" => "0.99",
      "app.getfolding.Folding.tip.medium" => "2.99",
      "app.getfolding.Folding.tip.large" => "4.99"
    }
    unless products.to_h { |p|
             [p.fetch("product_id"), p.fetch("usd_price")]
           } == expected_prices
      raise DiagnosticError, "Wrong US tip prices"
    end
    unless value["base_territory"] == "USA" && value["currency"] == "USD" &&
             value["availability"] == "mirror_selected_app_territories"
      raise DiagnosticError, "Wrong base currency/availability policy"
    end
    products.each do |product|
      unless product.fetch("localizations").keys.sort == locales
        raise DiagnosticError, "Incomplete tip locales"
      end
      product
        .fetch("localizations")
        .each_value do |text|
          unless (1..30).cover?(text.fetch("name").length) &&
                   (1..55).cover?(text.fetch("description").length)
            raise DiagnosticError, "Invalid product localization length"
          end
        end
    end
    value
  end

  def self.link(type, id)
    { "data" => { "type" => type, "id" => id } }
  end

  def self.resource(type, attributes: {}, relationships: {}, id: nil)
    data = { "type" => type }
    data["attributes"] = attributes unless attributes.empty?
    data["relationships"] = relationships unless relationships.empty?
    data["id"] = id if id
    { "data" => data }
  end

  def self.related_id(row, relationship)
    row.fetch("relationships").fetch(relationship).fetch("data").fetch("id")
  end

  def self.ensure_product(api, config, product)
    matches =
      api
        .all(
          "/v1/apps/#{config.fetch("app_store_id")}/inAppPurchasesV2?limit=200"
        )
        .select do |row|
          row.fetch("attributes")["productId"] == product.fetch("product_id")
        end
    raise DiagnosticError, "Duplicate tip products" if matches.length > 1
    desired = {
      "name" => product.fetch("reference_name"),
      "reviewNote" => config.fetch("review_note")
    }
    if matches.empty?
      row =
        api.request(
          "POST",
          "/v2/inAppPurchases",
          body:
            resource(
              "inAppPurchases",
              attributes:
                desired.merge(
                  "productId" => product.fetch("product_id"),
                  "inAppPurchaseType" => "CONSUMABLE"
                ),
              relationships: {
                "app" => link("apps", config.fetch("app_store_id"))
              }
            )
        ).fetch("data")
    else
      row = matches.first
      unless row.fetch("attributes")["inAppPurchaseType"] == "CONSUMABLE"
        raise DiagnosticError, "Existing product is not consumable"
      end
      changes =
        desired.reject { |key, value| row.fetch("attributes")[key] == value }
      unless changes.empty?
        row =
          api.request(
            "PATCH",
            "/v2/inAppPurchases/#{row.fetch("id")}",
            body:
              resource(
                "inAppPurchases",
                id: row.fetch("id"),
                attributes: changes
              )
          ).fetch("data")
      end
    end
    row.fetch("id")
  end

  def self.localize(api, id, product, &progress)
    rows =
      api.all("/v2/inAppPurchases/#{id}/inAppPurchaseLocalizations?limit=200")
    product
      .fetch("localizations")
      .each do |locale, text|
        progress&.call(locale)
        matches =
          rows.select { |row| row.fetch("attributes")["locale"] == locale }
        raise DiagnosticError, "Duplicate purchase locale" if matches.length > 1
        if matches.empty?
          api.request(
            "POST",
            "/v1/inAppPurchaseLocalizations",
            body:
              resource(
                "inAppPurchaseLocalizations",
                attributes: text.merge("locale" => locale),
                relationships: {
                  "inAppPurchaseV2" => link("inAppPurchases", id)
                }
              )
          )
        else
          row = matches.first
          changes =
            text.reject { |key, value| row.fetch("attributes")[key] == value }
          unless changes.empty?
            api.request(
              "PATCH",
              "/v1/inAppPurchaseLocalizations/#{row.fetch("id")}",
              body:
                resource(
                  "inAppPurchaseLocalizations",
                  id: row.fetch("id"),
                  attributes: changes
                )
            )
          end
        end
      end
    progress&.call("readback")
    readback =
      api.all("/v2/inAppPurchases/#{id}/inAppPurchaseLocalizations?limit=200")
    unless product
             .fetch("localizations")
             .all? { |locale, text|
               readback.any? do |row|
                 row.fetch("attributes")["locale"] == locale &&
                   text.all? do |key, value|
                     row.fetch("attributes")[key] == value
                   end
               end
             }
      raise DiagnosticError, "Product locale readback incomplete"
    end
  end

  def self.price_matches?(api, id, point)
    response =
      api.request(
        "GET",
        "/v2/inAppPurchases/#{id}/iapPriceSchedule?include=baseTerritory",
        missing: true
      )
    return false unless response && response["data"]
    schedule = response.fetch("data")
    unless related_id(schedule, "baseTerritory") == "USA"
      raise DiagnosticError,
            "Existing base territory differs; inspect before repricing"
    end
    prices =
      api.all(
        "/v1/inAppPurchasePriceSchedules/#{schedule.fetch("id")}/manualPrices?include=inAppPurchasePricePoint,territory&limit=200"
      )
    active =
      prices.reject do |price|
        price.fetch("attributes")["endDate"] &&
          price.fetch("attributes")["endDate"] <
            Time.now.utc.strftime("%Y-%m-%d")
      end
    unless active.length <= 1 &&
             active.all? { |price|
               related_id(price, "territory") == "USA" &&
                 price.fetch("attributes")["endDate"].nil? &&
                 (
                   price.fetch("attributes")["startDate"].nil? ||
                     price.fetch("attributes")["startDate"] <=
                       Time.now.utc.strftime("%Y-%m-%d")
                 )
             }
      raise DiagnosticError,
            "Custom/future price schedule exists; do not overwrite automatically"
    end
    active.length == 1 &&
      related_id(active.first, "inAppPurchasePricePoint") == point
  end

  def self.ensure_price(api, id, product)
    points =
      api.all(
        "/v2/inAppPurchases/#{id}/pricePoints?filter%5Bterritory%5D=USA&include=territory&limit=8000"
      )
    matches =
      points.select do |point|
        related_id(point, "territory") == "USA" &&
          BigDecimal(point.fetch("attributes").fetch("customerPrice")) ==
            BigDecimal(product.fetch("usd_price"))
      end
    unless matches.length == 1
      raise DiagnosticError, "Expected exactly one real Apple US price point"
    end
    point = matches.first.fetch("id")
    unless price_matches?(api, id, point)
      # The ${...} ID links an inline resource, not a fabricated Apple price-point identifier.
      inline_id = "${folding-base-price}"
      body =
        resource(
          "inAppPurchasePriceSchedules",
          relationships: {
            "inAppPurchase" => link("inAppPurchases", id),
            "baseTerritory" => link("territories", "USA"),
            "manualPrices" => {
              "data" => [{ "type" => "inAppPurchasePrices", "id" => inline_id }]
            }
          }
        )
      body["included"] = [
        {
          "type" => "inAppPurchasePrices",
          "id" => inline_id,
          "attributes" => {
            "startDate" => nil,
            "endDate" => nil
          },
          "relationships" => {
            "inAppPurchaseV2" => link("inAppPurchases", id),
            "inAppPurchasePricePoint" => link("inAppPurchasePricePoints", point)
          }
        }
      ]
      api.request("POST", "/v1/inAppPurchasePriceSchedules", body: body)
      unless price_matches?(api, id, point)
        raise DiagnosticError, "Price schedule readback incomplete"
      end
    end
    point
  end

  def self.app_territories(api, config)
    response =
      api.request(
        "GET",
        "/v1/apps/#{config.fetch("app_store_id")}/appAvailabilityV2",
        missing: true
      )
    unless response && response["data"]
      raise DiagnosticError,
            "Configure app territory availability before tip availability"
    end
    row = response.fetch("data")
    territories =
      api
        .all(
          "/v2/appAvailabilities/#{row.fetch("id")}/territoryAvailabilities?include=territory&limit=200"
        )
        .select do |territory|
          territory.fetch("attributes")["available"] == true
        end
        .map { |territory| related_id(territory, "territory") }
        .uniq
        .sort
    raise DiagnosticError, "No selected app territories" if territories.empty?
    [territories, row.fetch("attributes").fetch("availableInNewTerritories")]
  end

  def self.availability_matches?(api, id, territories, future)
    response =
      api.request(
        "GET",
        "/v2/inAppPurchases/#{id}/inAppPurchaseAvailability",
        missing: true
      )
    return false unless response && response["data"]
    row = response.fetch("data")
    current =
      api
        .all(
          "/v1/inAppPurchaseAvailabilities/#{row.fetch("id")}/availableTerritories?limit=200"
        )
        .map { |territory| territory.fetch("id") }
        .sort
    row.fetch("attributes")["availableInNewTerritories"] == future &&
      current == territories
  end

  def self.ensure_availability(api, id, territories, future)
    return if availability_matches?(api, id, territories, future)
    api.request(
      "POST",
      "/v1/inAppPurchaseAvailabilities",
      body:
        resource(
          "inAppPurchaseAvailabilities",
          attributes: {
            "availableInNewTerritories" => future
          },
          relationships: {
            "inAppPurchase" => link("inAppPurchases", id),
            "availableTerritories" => {
              "data" =>
                territories.map do |territory|
                  { "type" => "territories", "id" => territory }
                end
            }
          }
        )
    )
    unless availability_matches?(api, id, territories, future)
      raise DiagnosticError, "Availability readback incomplete"
    end
  end

  def self.review_screenshot(api, id, path)
    bytes = File.binread(path)
    unless bytes.start_with?("\x89PNG\r\n\x1a\n".b)
      raise DiagnosticError, "Expected a PNG review screenshot"
    end
    checksum = Digest::MD5.hexdigest(bytes) # Apple's asset checksum protocol, not a security hash.
    response =
      api.request(
        "GET",
        "/v2/inAppPurchases/#{id}/appStoreReviewScreenshot",
        missing: true
      )
    screenshot = response && response["data"]
    name = "folding-tip-#{Digest::SHA256.hexdigest(bytes)[0, 20]}.png"
    if screenshot
      attributes = screenshot.fetch("attributes")
      state = attributes.fetch("assetDeliveryState", {})["state"]
      if attributes["sourceFileChecksum"] == checksum &&
           %w[UPLOAD_COMPLETE COMPLETE].include?(state)
        return(
          {
            "id" => screenshot.fetch("id"),
            "state" => state,
            "sha256" => Digest::SHA256.hexdigest(bytes)
          }
        )
      end
      unless attributes["fileName"] == name &&
               attributes["fileSize"] == bytes.bytesize &&
               state == "AWAITING_UPLOAD"
        raise DiagnosticError,
              "Existing review asset differs/failed; inspect without automatic deletion"
      end
    else
      screenshot =
        api.request(
          "POST",
          "/v1/inAppPurchaseAppStoreReviewScreenshots",
          body:
            resource(
              "inAppPurchaseAppStoreReviewScreenshots",
              attributes: {
                "fileName" => name,
                "fileSize" => bytes.bytesize
              },
              relationships: {
                "inAppPurchaseV2" => link("inAppPurchases", id)
              }
            )
        ).fetch("data")
    end
    operations =
      screenshot
        .fetch("attributes")
        .fetch("uploadOperations")
        .sort_by { |operation| operation.fetch("offset") }
    cursor = 0
    operations.each do |operation|
      length = operation.fetch("length")
      unless operation.fetch("offset") == cursor && length.positive? &&
               cursor + length <= bytes.bytesize
        raise DiagnosticError, "Invalid upload byte ranges"
      end
      uri = URI(operation.fetch("url"))
      allowed =
        %w[apple.com icloud.com icloud-content.com mzstatic.com].any? do |host|
          uri.host == host || uri.host.to_s.end_with?(".#{host}")
        end
      unless uri.scheme == "https" && uri.port == 443 && uri.userinfo.nil? &&
               allowed && operation.fetch("method") == "PUT"
        raise DiagnosticError, "Unrecognized Apple upload destination"
      end
      request = Net::HTTP::Put.new(uri)
      operation
        .fetch("requestHeaders", [])
        .each { |header| request[header.fetch("name")] = header.fetch("value") }
      request.body = bytes.byteslice(cursor, length)
      # No API bearer token, redirect following, URL/header logging or automatic mutation retry.
      response =
        Net::HTTP.start(
          uri.host,
          uri.port,
          use_ssl: true,
          open_timeout: 15,
          read_timeout: 120
        ) { |http| http.request(request) }
      unless response.is_a?(Net::HTTPSuccess)
        raise DiagnosticError,
              "Apple review asset upload failed (HTTP #{response.code})"
      end
      cursor += length
    end
    unless cursor == bytes.bytesize
      raise DiagnosticError, "Incomplete upload byte coverage"
    end
    asset_id = screenshot.fetch("id")
    api.request(
      "PATCH",
      "/v1/inAppPurchaseAppStoreReviewScreenshots/#{asset_id}",
      body:
        resource(
          "inAppPurchaseAppStoreReviewScreenshots",
          id: asset_id,
          attributes: {
            "sourceFileChecksum" => checksum,
            "uploaded" => true
          }
        )
    )
    current = nil
    5.times do |attempt|
      current =
        api.request(
          "GET",
          "/v2/inAppPurchases/#{id}/appStoreReviewScreenshot"
        ).fetch("data")
      if current.fetch("id") == asset_id &&
           current.fetch("attributes")["sourceFileChecksum"] == checksum
        break
      end
      sleep 2 if attempt < 4
    end
    unless current.fetch("id") == asset_id &&
             current.fetch("attributes")["sourceFileChecksum"] == checksum
      raise DiagnosticError, "Review asset checksum readback failed"
    end
    {
      "id" => asset_id,
      "state" =>
        current.fetch("attributes").fetch("assetDeliveryState").fetch("state"),
      "sha256" => Digest::SHA256.hexdigest(bytes)
    }
  end

  def self.progress(message)
    $stdout.puts("Tips: #{message}")
    $stdout.flush
  end

  def self.fail_cleanly(error, stage, api = nil)
    detail =
      (
        if error.is_a?(DiagnosticError)
          error.message
        else
          "#{error.class}; inspect recorded stage and Apple state"
        end
      )
    message =
      "Tip setup stopped at #{stage}: #{detail}. No write was automatically retried."
    raise FastlaneCore::Interface::FastlaneError.new, message, [], cause: nil
  end

  def self.setup(screenshot_manifest: nil)
    stage = "configuration"
    config = source
    attempt_id = SecureRandom.uuid
    directory = File.join(FoldingRelease::ROOT, "build/tips")
    FileUtils.mkdir_p(File.join(directory, "attempts"))
    path = File.join(directory, "product-inventory.json")
    if File.file?(path)
      FileUtils.cp(
        path,
        File.join(directory, "attempts/prior-#{attempt_id}.json")
      )
    end
    attempt = File.join(directory, "attempts/#{attempt_id}.json")
    report = {
      "schema_version" => 1,
      "attempt_id" => attempt_id,
      "started_at" => Time.now.utc.iso8601,
      "status" => "in_progress",
      "app_store_id" => config.fetch("app_store_id"),
      "source_sha256" => FoldingRelease.sha(SOURCE_PATH),
      "submission_requested" => false,
      "products" => []
    }
    checkpoint =
      lambda do
        report["stage"] = stage
        report["updated_at"] = Time.now.utc.iso8601
        FoldingRelease.atomic_json(attempt, report)
        FoldingRelease.atomic_json(path, report)
      end
    checkpoint.call
    screenshots =
      screenshot_manifest ? JSON.parse(File.read(screenshot_manifest)) : {}
    unless (
             screenshots.keys -
               config.fetch("products").map { |p| p.fetch("product_id") }
           ).empty?
      raise DiagnosticError, "Unknown review screenshot product"
    end
    screenshots.each_value do |file|
      unless file.is_a?(String)
        raise DiagnosticError, "Review screenshot must be a path"
      end
      unless File.file?(
               File.expand_path(file, File.dirname(screenshot_manifest))
             )
        raise DiagnosticError, "Review screenshot is missing"
      end
    end
    stage = "app_identity"
    progress(stage)
    checkpoint.call
    api = API.new
    app =
      api.request("GET", "/v1/apps/#{config.fetch("app_store_id")}").fetch(
        "data"
      )
    unless app.fetch("attributes")["bundleId"] == config.fetch("bundle_id")
      raise DiagnosticError, "Wrong App Store app"
    end
    config
      .fetch("products")
      .each do |product|
        label = product.fetch("product_id").split(".").last
        entry = {
          "product_id" => product.fetch("product_id"),
          "status" => "in_progress"
        }
        report.fetch("products") << entry
        step =
          lambda do |name|
            stage = "#{label}/#{name}"
            entry["stage"] = name
            progress(stage)
            checkpoint.call
          end
        step.call("product")
        id = ensure_product(api, config, product)
        entry["id"] = id
        checkpoint.call
        step.call("localizations")
        localize(api, id, product) do |locale|
          step.call("localizations/#{locale}")
        end
        entry["locale_count"] = product.fetch("localizations").length
        checkpoint.call
        step.call("price")
        price = ensure_price(api, id, product)
        entry.merge!(
          "price_point_id" => price,
          "base_territory" => "USA",
          "usd_price" => product.fetch("usd_price")
        )
        checkpoint.call
        step.call("app_availability")
        territories, future = app_territories(api, config)
        step.call("product_availability")
        ensure_availability(api, id, territories, future)
        entry["territories"] = territories
        checkpoint.call
        step.call("review_screenshot")
        screenshot = screenshots[product.fetch("product_id")]
        entry["review_screenshot"] = (
          if screenshot
            review_screenshot(
              api,
              id,
              File.expand_path(screenshot, File.dirname(screenshot_manifest))
            )
          else
            { "state" => "not_supplied" }
          end
        )
        checkpoint.call
        step.call("product_readback")
        current = api.request("GET", "/v2/inAppPurchases/#{id}").fetch("data")
        entry["state"] = current.fetch("attributes").fetch("state")
        entry["status"] = "prepared"
        checkpoint.call
      end
    stage = "complete"
    report["status"] = "prepared"
    checkpoint.call
    progress("complete (no submission)")
    report
  rescue StandardError => error
    if report && checkpoint
      report["status"] = "stopped"
      report["error_category"] = error.class.name
      report["last_request"] = api.last_request if api
      begin
        checkpoint.call
      rescue StandardError
        progress(
          "Could not persist the stopped-attempt report; inspect prior checkpoint"
        )
      end
    end
    fail_cleanly(error, stage || "configuration", api)
  end

  # Apple stores the live selection; this file owns the desired policy.
  def self.app_availability_policy
    policy =
      JSON.parse(
        File.read(
          File.join(FoldingRelease::ROOT, "fastlane/app-availability.json")
        )
      )
    excluded = policy["excluded_territories"]
    valid =
      policy.keys.sort ==
        %w[available_in_new_territories excluded_territories schema_version] &&
        policy["schema_version"] == 1 &&
        [true, false].include?(policy["available_in_new_territories"]) &&
        excluded.is_a?(Array) &&
        excluded.all? { |id| id.is_a?(String) && id.match?(/\A[A-Z]{3}\z/) } &&
        excluded.uniq == excluded
    raise DiagnosticError, "Invalid app availability policy" unless valid
    policy
  end

  def self.configure_app_availability(api: API.new)
    config = source
    policy = app_availability_policy
    app_id = config.fetch("app_store_id")
    future = policy.fetch("available_in_new_territories")
    progress("app availability/readback")
    app = api.request("GET", "/v1/apps/#{app_id}").fetch("data")
    unless app.fetch("attributes")["bundleId"] == config.fetch("bundle_id")
      raise DiagnosticError, "Wrong App Store app"
    end
    territories =
      api
        .all("/v1/territories?limit=200")
        .map { |territory| territory.fetch("id") }
        .uniq
        .sort
    if territories.empty? ||
         !territories.all? { |id| id.match?(/\A[A-Z]{3}\z/) }
      raise DiagnosticError, "Apple returned invalid territories"
    end
    excluded = policy.fetch("excluded_territories")
    unless (excluded - territories).empty?
      raise DiagnosticError,
            "Unknown excluded territories: #{(excluded - territories).join(", ")}"
    end
    desired = territories - excluded
    if desired.empty?
      raise DiagnosticError, "App availability policy selects no territories"
    end
    existing =
      api.request("GET", "/v1/apps/#{app_id}/appAvailabilityV2", missing: true)
    row = existing && existing["data"]
    created = row.nil?
    path = ->(value) do
      "/v2/appAvailabilities/#{value.fetch("id")}/territoryAvailabilities?include=territory&limit=200"
    end
    selected = row ? api.all(path.call(row)) : []
    by_territory =
      selected.to_h { |item| [related_id(item, "territory"), item] }
    # Reconcile existing resources in place, preserving release and pre-order dates.
    selected.each do |item|
      wanted = desired.include?(related_id(item, "territory"))
      next if item.fetch("attributes").fetch("available") == wanted
      api.request(
        "PATCH",
        "/v1/territoryAvailabilities/#{item.fetch("id")}",
        body:
          resource(
            "territoryAvailabilities",
            id: item.fetch("id"),
            attributes: {
              "available" => wanted
            }
          )
      )
    end
    missing = desired - by_territory.keys
    if created || !missing.empty? ||
         row.fetch("attributes")["availableInNewTerritories"] != future
      identifiers =
        desired.map do |territory|
          {
            "type" => "territoryAvailabilities",
            "id" =>
              by_territory[territory]&.fetch("id") || "${folding-#{territory}}"
          }
        end
      body =
        resource(
          "appAvailabilities",
          attributes: {
            "availableInNewTerritories" => future
          },
          relationships: {
            "app" => link("apps", app_id),
            "territoryAvailabilities" => {
              "data" => identifiers
            }
          }
        )
      body["included"] = missing.map do |territory|
        {
          "type" => "territoryAvailabilities",
          "id" => "${folding-#{territory}}",
          "attributes" => {
            "available" => true
          },
          "relationships" => {
            "territory" => link("territories", territory)
          }
        }
      end
      api.request("POST", "/v2/appAvailabilities", body: body)
    end
    row =
      api.request("GET", "/v1/apps/#{app_id}/appAvailabilityV2").fetch("data")
    selected = api.all(path.call(row))
    actual =
      selected
        .select { |item| item.fetch("attributes")["available"] == true }
        .map { |item| related_id(item, "territory") }
        .sort
    unless actual == desired &&
             row.fetch("attributes")["availableInNewTerritories"] == future
      raise DiagnosticError,
            "App availability readback incomplete; rerun to reconcile"
    end
    report = {
      "schema_version" => 1,
      "app_store_id" => app_id,
      "availability_id" => row.fetch("id"),
      "created" => created,
      "policy_sha256" =>
        FoldingRelease.sha(
          File.join(FoldingRelease::ROOT, "fastlane/app-availability.json")
        ),
      "available_in_new_territories" => future,
      "excluded_territories" => excluded,
      "selected_territories" => actual,
      "legal_answers_modified" => false,
      "verified_at" => Time.now.utc.iso8601
    }
    FoldingRelease.atomic_json(
      File.join(FoldingRelease::ROOT, "build/tips/app-availability.json"),
      report
    )
    progress("app availability verified: #{actual.length} selected territories")
    report
  rescue StandardError => error
    fail_cleanly(error, "app_availability", api)
  end
end
