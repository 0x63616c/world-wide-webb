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

  class API
    def initialize
      @client = FoldingAppleAccount.client
    end

    def request(method, path, body: nil, missing: false)
      uri = URI.join(API_ORIGIN, path)
      raise "Unexpected Apple API origin" unless uri.scheme == "https" && uri.host == "api.appstoreconnect.apple.com" && uri.port == 443 && uri.userinfo.nil? && uri.path.match?(%r{\A/v[12]/})
      token = @client.token
      token.refresh! if token.expired?
      request = {"GET" => Net::HTTP::Get, "POST" => Net::HTTP::Post, "PATCH" => Net::HTTP::Patch}.fetch(method).new(uri)
      request["Authorization"] = "Bearer #{token.text}"
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(body) if body
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 60) { |http| http.request(request) }
      return nil if missing && response.code == "404"
      raise "Apple product API returned HTTP #{response.code}; inspect readback before retry" unless response.is_a?(Net::HTTPSuccess)
      JSON.parse(response.body)
    rescue JSON::ParserError
      raise "Apple product API returned invalid JSON"
    end

    def all(path)
      rows = []
      visited = []
      while path
        raise "Apple pagination loop" if visited.include?(path)
        visited << path
        page = request("GET", path)
        raise "Expected resource collection" unless page.fetch("data").is_a?(Array)
        rows.concat(page.fetch("data"))
        path = page.fetch("links", {})["next"]
      end
      rows
    end
  end

  def self.source
    value = JSON.parse(File.read(SOURCE_PATH))
    raise "Wrong tip app" unless value["schema_version"] == 1 && value["app_store_id"] == "6832059501" && value["bundle_id"] == "app.getfolding.Folding"
    products = value.fetch("products")
    raise "Wrong tip product set" unless products.map { |p| p.fetch("product_id") }.sort == FoldingRelease::CONFIG.fetch("tip_product_ids").sort
    locales = FoldingRelease.read_json(File.join(FoldingRelease::ROOT, "fastlane/locales.json")).fetch("locales").map { |l| l.fetch("storefront_locale") }.sort
    expected_prices = {"app.getfolding.Folding.tip.small" => "0.99", "app.getfolding.Folding.tip.medium" => "2.99", "app.getfolding.Folding.tip.large" => "4.99"}
    raise "Wrong US tip prices" unless products.to_h { |p| [p.fetch("product_id"), p.fetch("usd_price")] } == expected_prices
    raise "Wrong base currency/availability policy" unless value["base_territory"] == "USA" && value["currency"] == "USD" && value["availability"] == "mirror_selected_app_territories"
    products.each do |product|
      raise "Incomplete tip locales" unless product.fetch("localizations").keys.sort == locales
      product.fetch("localizations").each_value do |text|
        raise "Invalid product localization length" unless (1..30).cover?(text.fetch("name").length) && (1..55).cover?(text.fetch("description").length)
      end
    end
    value
  end

  def self.link(type, id)
    {"data" => {"type" => type, "id" => id}}
  end

  def self.resource(type, attributes: {}, relationships: {}, id: nil)
    data = {"type" => type}
    data["attributes"] = attributes unless attributes.empty?
    data["relationships"] = relationships unless relationships.empty?
    data["id"] = id if id
    {"data" => data}
  end

  def self.related_id(row, relationship)
    row.fetch("relationships").fetch(relationship).fetch("data").fetch("id")
  end

  def self.ensure_product(api, config, product)
    matches = api.all("/v1/apps/#{config.fetch('app_store_id')}/inAppPurchasesV2?limit=200").select { |row| row.fetch("attributes")["productId"] == product.fetch("product_id") }
    raise "Duplicate tip products" if matches.length > 1
    desired = {"name" => product.fetch("reference_name"), "reviewNote" => config.fetch("review_note")}
    if matches.empty?
      row = api.request("POST", "/v2/inAppPurchases", body: resource("inAppPurchases",
        attributes: desired.merge("productId" => product.fetch("product_id"), "inAppPurchaseType" => "CONSUMABLE"),
        relationships: {"app" => link("apps", config.fetch("app_store_id"))})).fetch("data")
    else
      row = matches.first
      raise "Existing product is not consumable" unless row.fetch("attributes")["inAppPurchaseType"] == "CONSUMABLE"
      changes = desired.reject { |key, value| row.fetch("attributes")[key] == value }
      unless changes.empty?
        row = api.request("PATCH", "/v2/inAppPurchases/#{row.fetch('id')}", body: resource("inAppPurchases", id: row.fetch("id"), attributes: changes)).fetch("data")
      end
    end
    row.fetch("id")
  end

  def self.localize(api, id, product)
    rows = api.all("/v2/inAppPurchases/#{id}/inAppPurchaseLocalizations?limit=200")
    product.fetch("localizations").each do |locale, text|
      matches = rows.select { |row| row.fetch("attributes")["locale"] == locale }
      raise "Duplicate purchase locale" if matches.length > 1
      if matches.empty?
        api.request("POST", "/v1/inAppPurchaseLocalizations", body: resource("inAppPurchaseLocalizations",
          attributes: text.merge("locale" => locale), relationships: {"inAppPurchaseV2" => link("inAppPurchases", id)}))
      else
        row = matches.first
        changes = text.reject { |key, value| row.fetch("attributes")[key] == value }
        api.request("PATCH", "/v1/inAppPurchaseLocalizations/#{row.fetch('id')}", body: resource("inAppPurchaseLocalizations", id: row.fetch("id"), attributes: changes)) unless changes.empty?
      end
    end
    readback = api.all("/v2/inAppPurchases/#{id}/inAppPurchaseLocalizations?limit=200")
    raise "Product locale readback incomplete" unless product.fetch("localizations").all? { |locale, text| readback.any? { |row| row.fetch("attributes")["locale"] == locale && text.all? { |key, value| row.fetch("attributes")[key] == value } } }
  end

  def self.price_matches?(api, id, point)
    response = api.request("GET", "/v2/inAppPurchases/#{id}/iapPriceSchedule?include=baseTerritory", missing: true)
    return false unless response && response["data"]
    schedule = response.fetch("data")
    raise "Existing base territory differs; inspect before repricing" unless related_id(schedule, "baseTerritory") == "USA"
    prices = api.all("/v1/inAppPurchasePriceSchedules/#{schedule.fetch('id')}/manualPrices?include=inAppPurchasePricePoint,territory&limit=200")
    active = prices.reject { |price| price.fetch("attributes")["endDate"] && price.fetch("attributes")["endDate"] < Time.now.utc.strftime("%Y-%m-%d") }
    raise "Custom/future price schedule exists; do not overwrite automatically" unless active.length <= 1 && active.all? { |price| related_id(price, "territory") == "USA" && price.fetch("attributes")["endDate"].nil? && (price.fetch("attributes")["startDate"].nil? || price.fetch("attributes")["startDate"] <= Time.now.utc.strftime("%Y-%m-%d")) }
    active.length == 1 && related_id(active.first, "inAppPurchasePricePoint") == point
  end

  def self.ensure_price(api, id, product)
    points = api.all("/v2/inAppPurchases/#{id}/pricePoints?filter%5Bterritory%5D=USA&include=territory&limit=8000")
    matches = points.select { |point| related_id(point, "territory") == "USA" && BigDecimal(point.fetch("attributes").fetch("customerPrice")) == BigDecimal(product.fetch("usd_price")) }
    raise "Expected exactly one real Apple US price point" unless matches.length == 1
    point = matches.first.fetch("id")
    unless price_matches?(api, id, point)
      # The ${...} ID links an inline resource, not a fabricated Apple price-point identifier.
      inline_id = "${folding-base-price}"
      body = resource("inAppPurchasePriceSchedules", relationships: {
        "inAppPurchase" => link("inAppPurchases", id), "baseTerritory" => link("territories", "USA"),
        "manualPrices" => {"data" => [{"type" => "inAppPurchasePrices", "id" => inline_id}]}})
      body["included"] = [{"type" => "inAppPurchasePrices", "id" => inline_id,
        "attributes" => {"startDate" => nil, "endDate" => nil},
        "relationships" => {"inAppPurchaseV2" => link("inAppPurchases", id), "inAppPurchasePricePoint" => link("inAppPurchasePricePoints", point)}}]
      api.request("POST", "/v1/inAppPurchasePriceSchedules", body: body)
      raise "Price schedule readback incomplete" unless price_matches?(api, id, point)
    end
    point
  end

  def self.app_territories(api, config)
    response = api.request("GET", "/v1/apps/#{config.fetch('app_store_id')}/appAvailabilityV2", missing: true)
    raise "Configure app territory availability before tip availability" unless response && response["data"]
    row = response.fetch("data")
    territories = api.all("/v2/appAvailabilities/#{row.fetch('id')}/territoryAvailabilities?include=territory&limit=200")
      .select { |territory| territory.fetch("attributes")["available"] == true }.map { |territory| related_id(territory, "territory") }.uniq.sort
    raise "No selected app territories" if territories.empty?
    [territories, row.fetch("attributes").fetch("availableInNewTerritories")]
  end

  def self.availability_matches?(api, id, territories, future)
    response = api.request("GET", "/v2/inAppPurchases/#{id}/inAppPurchaseAvailability", missing: true)
    return false unless response && response["data"]
    row = response.fetch("data")
    current = api.all("/v1/inAppPurchaseAvailabilities/#{row.fetch('id')}/availableTerritories?limit=200").map { |territory| territory.fetch("id") }.sort
    row.fetch("attributes")["availableInNewTerritories"] == future && current == territories
  end

  def self.ensure_availability(api, id, territories, future)
    return if availability_matches?(api, id, territories, future)
    api.request("POST", "/v1/inAppPurchaseAvailabilities", body: resource("inAppPurchaseAvailabilities",
      attributes: {"availableInNewTerritories" => future}, relationships: {
        "inAppPurchase" => link("inAppPurchases", id),
        "availableTerritories" => {"data" => territories.map { |territory| {"type" => "territories", "id" => territory} }}}))
    raise "Availability readback incomplete" unless availability_matches?(api, id, territories, future)
  end

  def self.review_screenshot(api, id, path)
    bytes = File.binread(path)
    raise "Expected a PNG review screenshot" unless bytes.start_with?("\x89PNG\r\n\x1a\n".b)
    checksum = Digest::MD5.hexdigest(bytes) # Apple's asset checksum protocol, not a security hash.
    response = api.request("GET", "/v2/inAppPurchases/#{id}/appStoreReviewScreenshot", missing: true)
    screenshot = response && response["data"]
    name = "folding-tip-#{Digest::SHA256.hexdigest(bytes)[0, 20]}.png"
    if screenshot
      attributes = screenshot.fetch("attributes")
      state = attributes.fetch("assetDeliveryState", {})["state"]
      if attributes["sourceFileChecksum"] == checksum && %w[UPLOAD_COMPLETE COMPLETE].include?(state)
        return {"id" => screenshot.fetch("id"), "state" => state, "sha256" => Digest::SHA256.hexdigest(bytes)}
      end
      raise "Existing review asset differs/failed; inspect without automatic deletion" unless attributes["fileName"] == name && attributes["fileSize"] == bytes.bytesize && state == "AWAITING_UPLOAD"
    else
      screenshot = api.request("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", body: resource("inAppPurchaseAppStoreReviewScreenshots",
        attributes: {"fileName" => name, "fileSize" => bytes.bytesize}, relationships: {"inAppPurchaseV2" => link("inAppPurchases", id)})).fetch("data")
    end
    operations = screenshot.fetch("attributes").fetch("uploadOperations").sort_by { |operation| operation.fetch("offset") }
    cursor = 0
    operations.each do |operation|
      length = operation.fetch("length")
      raise "Invalid upload byte ranges" unless operation.fetch("offset") == cursor && length.positive? && cursor + length <= bytes.bytesize
      uri = URI(operation.fetch("url"))
      allowed = %w[apple.com icloud.com icloud-content.com mzstatic.com].any? { |host| uri.host == host || uri.host.to_s.end_with?(".#{host}") }
      raise "Unrecognized Apple upload destination" unless uri.scheme == "https" && uri.port == 443 && uri.userinfo.nil? && allowed && operation.fetch("method") == "PUT"
      request = Net::HTTP::Put.new(uri)
      operation.fetch("requestHeaders", []).each { |header| request[header.fetch("name")] = header.fetch("value") }
      request.body = bytes.byteslice(cursor, length)
      # No API bearer token, redirect following, URL/header logging or automatic mutation retry.
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 120) { |http| http.request(request) }
      raise "Apple review asset upload failed (HTTP #{response.code})" unless response.is_a?(Net::HTTPSuccess)
      cursor += length
    end
    raise "Incomplete upload byte coverage" unless cursor == bytes.bytesize
    asset_id = screenshot.fetch("id")
    api.request("PATCH", "/v1/inAppPurchaseAppStoreReviewScreenshots/#{asset_id}", body: resource("inAppPurchaseAppStoreReviewScreenshots", id: asset_id, attributes: {"sourceFileChecksum" => checksum, "uploaded" => true}))
    current = api.request("GET", "/v1/inAppPurchaseAppStoreReviewScreenshots/#{asset_id}").fetch("data")
    raise "Review asset checksum readback failed" unless current.fetch("attributes")["sourceFileChecksum"] == checksum
    {"id" => asset_id, "state" => current.fetch("attributes").fetch("assetDeliveryState").fetch("state"), "sha256" => Digest::SHA256.hexdigest(bytes)}
  end

  def self.setup(screenshot_manifest: nil)
    config = source
    api = API.new
    app = api.request("GET", "/v1/apps/#{config.fetch('app_store_id')}").fetch("data")
    raise "Wrong App Store app" unless app.fetch("attributes")["bundleId"] == config.fetch("bundle_id")
    screenshots = screenshot_manifest ? JSON.parse(File.read(screenshot_manifest)) : {}
    raise "Unknown review screenshot product" unless (screenshots.keys - config.fetch("products").map { |p| p.fetch("product_id") }).empty?
    screenshots.each_value do |file|
      raise "Review screenshot must be a path" unless file.is_a?(String)
      path = File.expand_path(file, File.dirname(screenshot_manifest))
      raise "Review screenshot is missing" unless File.file?(path)
    end
    report = {"schema_version" => 1, "app_store_id" => config.fetch("app_store_id"), "source_sha256" => FoldingRelease.sha(SOURCE_PATH), "submission_requested" => false, "products" => []}
    path = File.join(FoldingRelease::ROOT, "build/tips/product-inventory.json")
    config.fetch("products").each do |product|
      id = ensure_product(api, config, product)
      localize(api, id, product)
      price = ensure_price(api, id, product)
      territories, future = app_territories(api, config)
      ensure_availability(api, id, territories, future)
      screenshot = screenshots[product.fetch("product_id")]
      asset = screenshot ? review_screenshot(api, id, File.expand_path(screenshot, File.dirname(screenshot_manifest))) : nil
      current = api.request("GET", "/v2/inAppPurchases/#{id}").fetch("data")
      report.fetch("products") << {"product_id" => product.fetch("product_id"), "id" => id,
        "state" => current.fetch("attributes").fetch("state"), "base_territory" => "USA", "usd_price" => product.fetch("usd_price"),
        "price_point_id" => price, "locale_count" => product.fetch("localizations").length,
        "territories" => territories, "review_screenshot" => asset || {"state" => "not_supplied"}}
      FoldingRelease.atomic_json(path, report)
    end
    report
  end
end
