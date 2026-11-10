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

  class DiagnosticError < StandardError; end

  class API
    attr_reader :last_request
    def initialize
      @client = FoldingAppleAccount.client
    end

    def request(method, path, body: nil, missing: false)
      uri = URI.join(API_ORIGIN, path)
      raise DiagnosticError, "Unexpected Apple API origin" unless uri.scheme == "https" && uri.host == "api.appstoreconnect.apple.com" && uri.port == 443 && uri.userinfo.nil? && uri.path.match?(%r{\A/v[12]/})
      resources = %w[apps inAppPurchases inAppPurchaseLocalizations pricePoints iapPriceSchedule inAppPurchasePriceSchedules manualPrices appAvailabilityV2 appAvailabilities territoryAvailabilities inAppPurchaseAvailability inAppPurchaseAvailabilities availableTerritories inAppPurchaseAppStoreReviewScreenshots appStoreReviewScreenshot territories]
      @last_request = {"method" => method, "resource" => uri.path.split("/").select { |part| resources.include?(part) }.join("/")}
      token = @client.token
      token.refresh! if token.expired?
      request = {"GET" => Net::HTTP::Get, "POST" => Net::HTTP::Post, "PATCH" => Net::HTTP::Patch}.fetch(method).new(uri)
      request["Authorization"] = "Bearer #{token.text}"
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(body) if body
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 60) { |http| http.request(request) }
      @last_request["http_status"] = response.code.to_i
      return nil if missing && response.code == "404"
      unless response.is_a?(Net::HTTPSuccess)
        # Apple nests actionable submission failures under associatedErrors.
        # Keep codes/pointers, never provider messages containing private values.
        failures = self.class.error_codes(response.body)
        @last_request["errors"] = failures
        raise DiagnosticError, "Apple HTTP #{response.code}: #{failures.join('; ')}; reconcile current Apple state before retry"
      end
      JSON.parse(response.body)
    rescue Net::OpenTimeout, Net::ReadTimeout, Timeout::Error
      raise DiagnosticError, "Apple request timed out; outcome unknown, rerun to reconcile before mutations", cause: nil
    rescue SocketError, SystemCallError, OpenSSL::SSL::SSLError, EOFError, IOError
      raise DiagnosticError, "Apple transport failed; outcome unknown, rerun to reconcile", cause: nil
    rescue JSON::ParserError
      raise DiagnosticError, "Apple returned invalid JSON", cause: nil
    end

    def self.error_codes(body)
      collect = lambda do |errors|
        errors.flat_map do |error|
          own = [error["code"], error.dig("source", "pointer")].compact.join(" ")
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
        raise DiagnosticError, "Expected resource collection" unless page.fetch("data").is_a?(Array)
        rows.concat(page.fetch("data"))
        path = page.fetch("links", {})["next"]
      end
      rows
    end
  end

  def self.source
    value = JSON.parse(File.read(SOURCE_PATH))
    raise DiagnosticError, "Wrong tip app" unless value["schema_version"] == 1 && value["app_store_id"] == "6832059501" && value["bundle_id"] == "app.getfolding.Folding"
    products = value.fetch("products")
    raise DiagnosticError, "Wrong tip product set" unless products.map { |p| p.fetch("product_id") }.sort == FoldingRelease::CONFIG.fetch("tip_product_ids").sort
    locales = FoldingRelease.read_json(File.join(FoldingRelease::ROOT, "fastlane/locales.json")).fetch("locales").map { |l| l.fetch("storefront_locale") }.sort
    expected_prices = {"app.getfolding.Folding.tip.small" => "0.99", "app.getfolding.Folding.tip.medium" => "2.99", "app.getfolding.Folding.tip.large" => "4.99"}
    raise DiagnosticError, "Wrong US tip prices" unless products.to_h { |p| [p.fetch("product_id"), p.fetch("usd_price")] } == expected_prices
    raise DiagnosticError, "Wrong base currency/availability policy" unless value["base_territory"] == "USA" && value["currency"] == "USD" && value["availability"] == "mirror_selected_app_territories"
    products.each do |product|
      raise DiagnosticError, "Incomplete tip locales" unless product.fetch("localizations").keys.sort == locales
      product.fetch("localizations").each_value do |text|
        raise DiagnosticError, "Invalid product localization length" unless (1..30).cover?(text.fetch("name").length) && (1..55).cover?(text.fetch("description").length)
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
    raise DiagnosticError, "Duplicate tip products" if matches.length > 1
    desired = {"name" => product.fetch("reference_name"), "reviewNote" => config.fetch("review_note")}
    if matches.empty?
      row = api.request("POST", "/v2/inAppPurchases", body: resource("inAppPurchases",
        attributes: desired.merge("productId" => product.fetch("product_id"), "inAppPurchaseType" => "CONSUMABLE"),
        relationships: {"app" => link("apps", config.fetch("app_store_id"))})).fetch("data")
    else
      row = matches.first
      raise DiagnosticError, "Existing product is not consumable" unless row.fetch("attributes")["inAppPurchaseType"] == "CONSUMABLE"
      changes = desired.reject { |key, value| row.fetch("attributes")[key] == value }
      unless changes.empty?
        row = api.request("PATCH", "/v2/inAppPurchases/#{row.fetch('id')}", body: resource("inAppPurchases", id: row.fetch("id"), attributes: changes)).fetch("data")
      end
    end
    row.fetch("id")
  end

  def self.localize(api, id, product, &progress)
    rows = api.all("/v2/inAppPurchases/#{id}/inAppPurchaseLocalizations?limit=200")
    product.fetch("localizations").each do |locale, text|
      progress&.call(locale)
      matches = rows.select { |row| row.fetch("attributes")["locale"] == locale }
      raise DiagnosticError, "Duplicate purchase locale" if matches.length > 1
      if matches.empty?
        api.request("POST", "/v1/inAppPurchaseLocalizations", body: resource("inAppPurchaseLocalizations",
          attributes: text.merge("locale" => locale), relationships: {"inAppPurchaseV2" => link("inAppPurchases", id)}))
      else
        row = matches.first
        changes = text.reject { |key, value| row.fetch("attributes")[key] == value }
        api.request("PATCH", "/v1/inAppPurchaseLocalizations/#{row.fetch('id')}", body: resource("inAppPurchaseLocalizations", id: row.fetch("id"), attributes: changes)) unless changes.empty?
      end
    end
    progress&.call("readback")
    readback = api.all("/v2/inAppPurchases/#{id}/inAppPurchaseLocalizations?limit=200")
    raise DiagnosticError, "Product locale readback incomplete" unless product.fetch("localizations").all? { |locale, text| readback.any? { |row| row.fetch("attributes")["locale"] == locale && text.all? { |key, value| row.fetch("attributes")[key] == value } } }
  end

  def self.price_matches?(api, id, point)
    response = api.request("GET", "/v2/inAppPurchases/#{id}/iapPriceSchedule?include=baseTerritory", missing: true)
    return false unless response && response["data"]
    schedule = response.fetch("data")
    raise DiagnosticError, "Existing base territory differs; inspect before repricing" unless related_id(schedule, "baseTerritory") == "USA"
    prices = api.all("/v1/inAppPurchasePriceSchedules/#{schedule.fetch('id')}/manualPrices?include=inAppPurchasePricePoint,territory&limit=200")
    active = prices.reject { |price| price.fetch("attributes")["endDate"] && price.fetch("attributes")["endDate"] < Time.now.utc.strftime("%Y-%m-%d") }
    raise DiagnosticError, "Custom/future price schedule exists; do not overwrite automatically" unless active.length <= 1 && active.all? { |price| related_id(price, "territory") == "USA" && price.fetch("attributes")["endDate"].nil? && (price.fetch("attributes")["startDate"].nil? || price.fetch("attributes")["startDate"] <= Time.now.utc.strftime("%Y-%m-%d")) }
    active.length == 1 && related_id(active.first, "inAppPurchasePricePoint") == point
  end

  def self.ensure_price(api, id, product)
    points = api.all("/v2/inAppPurchases/#{id}/pricePoints?filter%5Bterritory%5D=USA&include=territory&limit=8000")
    matches = points.select { |point| related_id(point, "territory") == "USA" && BigDecimal(point.fetch("attributes").fetch("customerPrice")) == BigDecimal(product.fetch("usd_price")) }
    raise DiagnosticError, "Expected exactly one real Apple US price point" unless matches.length == 1
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
      raise DiagnosticError, "Price schedule readback incomplete" unless price_matches?(api, id, point)
    end
    point
  end

  def self.app_territories(api, config)
    response = api.request("GET", "/v1/apps/#{config.fetch('app_store_id')}/appAvailabilityV2", missing: true)
    raise DiagnosticError, "Configure app territory availability before tip availability" unless response && response["data"]
    row = response.fetch("data")
    territories = api.all("/v2/appAvailabilities/#{row.fetch('id')}/territoryAvailabilities?include=territory&limit=200")
      .select { |territory| territory.fetch("attributes")["available"] == true }.map { |territory| related_id(territory, "territory") }.uniq.sort
    raise DiagnosticError, "No selected app territories" if territories.empty?
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
    raise DiagnosticError, "Availability readback incomplete" unless availability_matches?(api, id, territories, future)
  end

  def self.review_screenshot(api, id, path)
    bytes = File.binread(path)
    raise DiagnosticError, "Expected a PNG review screenshot" unless bytes.start_with?("\x89PNG\r\n\x1a\n".b)
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
      raise DiagnosticError, "Existing review asset differs/failed; inspect without automatic deletion" unless attributes["fileName"] == name && attributes["fileSize"] == bytes.bytesize && state == "AWAITING_UPLOAD"
    else
      screenshot = api.request("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", body: resource("inAppPurchaseAppStoreReviewScreenshots",
        attributes: {"fileName" => name, "fileSize" => bytes.bytesize}, relationships: {"inAppPurchaseV2" => link("inAppPurchases", id)})).fetch("data")
    end
    operations = screenshot.fetch("attributes").fetch("uploadOperations").sort_by { |operation| operation.fetch("offset") }
    cursor = 0
    operations.each do |operation|
      length = operation.fetch("length")
      raise DiagnosticError, "Invalid upload byte ranges" unless operation.fetch("offset") == cursor && length.positive? && cursor + length <= bytes.bytesize
      uri = URI(operation.fetch("url"))
      allowed = %w[apple.com icloud.com icloud-content.com mzstatic.com].any? { |host| uri.host == host || uri.host.to_s.end_with?(".#{host}") }
      raise DiagnosticError, "Unrecognized Apple upload destination" unless uri.scheme == "https" && uri.port == 443 && uri.userinfo.nil? && allowed && operation.fetch("method") == "PUT"
      request = Net::HTTP::Put.new(uri)
      operation.fetch("requestHeaders", []).each { |header| request[header.fetch("name")] = header.fetch("value") }
      request.body = bytes.byteslice(cursor, length)
      # No API bearer token, redirect following, URL/header logging or automatic mutation retry.
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 120) { |http| http.request(request) }
      raise DiagnosticError, "Apple review asset upload failed (HTTP #{response.code})" unless response.is_a?(Net::HTTPSuccess)
      cursor += length
    end
    raise DiagnosticError, "Incomplete upload byte coverage" unless cursor == bytes.bytesize
    asset_id = screenshot.fetch("id")
    api.request("PATCH", "/v1/inAppPurchaseAppStoreReviewScreenshots/#{asset_id}", body: resource("inAppPurchaseAppStoreReviewScreenshots", id: asset_id, attributes: {"sourceFileChecksum" => checksum, "uploaded" => true}))
    current = nil
    5.times do |attempt|
      current = api.request("GET", "/v2/inAppPurchases/#{id}/appStoreReviewScreenshot").fetch("data")
      break if current.fetch("id") == asset_id && current.fetch("attributes")["sourceFileChecksum"] == checksum
      sleep 2 if attempt < 4
    end
    raise DiagnosticError, "Review asset checksum readback failed" unless current.fetch("id") == asset_id && current.fetch("attributes")["sourceFileChecksum"] == checksum
    {"id" => asset_id, "state" => current.fetch("attributes").fetch("assetDeliveryState").fetch("state"), "sha256" => Digest::SHA256.hexdigest(bytes)}
  end

  def self.progress(message)
    $stdout.puts("Tips: #{message}")
    $stdout.flush
  end

  def self.fail_cleanly(error, stage, api = nil)
    detail = error.is_a?(DiagnosticError) ? error.message : "#{error.class}; inspect recorded stage and Apple state"
    message = "Tip setup stopped at #{stage}: #{detail}. No write was automatically retried."
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
      FileUtils.cp(path, File.join(directory, "attempts/prior-#{attempt_id}.json"))
    end
    attempt = File.join(directory, "attempts/#{attempt_id}.json")
    report = {"schema_version" => 1, "attempt_id" => attempt_id,
      "started_at" => Time.now.utc.iso8601, "status" => "in_progress",
      "app_store_id" => config.fetch("app_store_id"), "source_sha256" => FoldingRelease.sha(SOURCE_PATH),
      "submission_requested" => false, "products" => []}
    checkpoint = lambda do
      report["stage"] = stage
      report["updated_at"] = Time.now.utc.iso8601
      FoldingRelease.atomic_json(attempt, report)
      FoldingRelease.atomic_json(path, report)
    end
    checkpoint.call
    screenshots = screenshot_manifest ? JSON.parse(File.read(screenshot_manifest)) : {}
    raise DiagnosticError, "Unknown review screenshot product" unless (screenshots.keys - config.fetch("products").map { |p| p.fetch("product_id") }).empty?
    screenshots.each_value do |file|
      raise DiagnosticError, "Review screenshot must be a path" unless file.is_a?(String)
      raise DiagnosticError, "Review screenshot is missing" unless File.file?(File.expand_path(file, File.dirname(screenshot_manifest)))
    end
    stage = "app_identity"
    progress(stage)
    checkpoint.call
    api = API.new
    app = api.request("GET", "/v1/apps/#{config.fetch('app_store_id')}").fetch("data")
    raise DiagnosticError, "Wrong App Store app" unless app.fetch("attributes")["bundleId"] == config.fetch("bundle_id")
    config.fetch("products").each do |product|
      label = product.fetch("product_id").split(".").last
      entry = {"product_id" => product.fetch("product_id"), "status" => "in_progress"}
      report.fetch("products") << entry
      step = lambda do |name|
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
      localize(api, id, product) { |locale| step.call("localizations/#{locale}") }
      entry["locale_count"] = product.fetch("localizations").length
      checkpoint.call
      step.call("price")
      price = ensure_price(api, id, product)
      entry.merge!("price_point_id" => price, "base_territory" => "USA", "usd_price" => product.fetch("usd_price"))
      checkpoint.call
      step.call("app_availability")
      territories, future = app_territories(api, config)
      step.call("product_availability")
      ensure_availability(api, id, territories, future)
      entry["territories"] = territories
      checkpoint.call
      step.call("review_screenshot")
      screenshot = screenshots[product.fetch("product_id")]
      entry["review_screenshot"] = screenshot ? review_screenshot(api, id, File.expand_path(screenshot, File.dirname(screenshot_manifest))) : {"state" => "not_supplied"}
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
        progress("Could not persist the stopped-attempt report; inspect prior checkpoint")
      end
    end
    fail_cleanly(error, stage || "configuration", api)
  end

  def self.configure_app_availability
    config = source
    api = API.new
    progress("app availability/readback")
    app = api.request("GET", "/v1/apps/#{config.fetch('app_store_id')}").fetch("data")
    raise DiagnosticError, "Wrong App Store app" unless app.fetch("attributes")["bundleId"] == config.fetch("bundle_id")
    existing = api.request("GET", "/v1/apps/#{config.fetch('app_store_id')}/appAvailabilityV2", missing: true)
    created = false
    if existing && existing["data"]
      row = existing.fetch("data")
      progress("app availability exists; preserving all selections")
    else
      progress("app availability/list territories")
      territories = api.all("/v1/territories?limit=200").map { |territory| territory.fetch("id") }.uniq.sort
      raise DiagnosticError, "Apple returned no territories" if territories.empty?
      raise DiagnosticError, "Unexpected territory identifier" unless territories.all? { |territory| territory.match?(/\A[A-Z]{3}\z/) }
      identifiers = territories.map { |territory| {"type" => "territoryAvailabilities", "id" => "${folding-#{territory}}"} }
      body = resource("appAvailabilities", attributes: {"availableInNewTerritories" => true}, relationships: {
        "app" => link("apps", config.fetch("app_store_id")), "territoryAvailabilities" => {"data" => identifiers}})
      body["included"] = territories.map do |territory|
        {"type" => "territoryAvailabilities", "id" => "${folding-#{territory}}", "attributes" => {"available" => true},
          "relationships" => {"territory" => link("territories", territory)}}
      end
      progress("app availability/create global selection")
      api.request("POST", "/v2/appAvailabilities", body: body)
      row = api.request("GET", "/v1/apps/#{config.fetch('app_store_id')}/appAvailabilityV2").fetch("data")
      created = true
    end
    selected = api.all("/v2/appAvailabilities/#{row.fetch('id')}/territoryAvailabilities?include=territory&limit=200")
    actual = selected.select { |item| item.fetch("attributes")["available"] == true }.map { |item| related_id(item, "territory") }.sort
    if created
      raise DiagnosticError, "App availability readback incomplete" unless actual == territories && row.fetch("attributes")["availableInNewTerritories"] == true
    end
    report = {"schema_version" => 1, "app_store_id" => config.fetch("app_store_id"), "availability_id" => row.fetch("id"),
      "created" => created, "existing_selection_preserved" => !created,
      "available_in_new_territories" => row.fetch("attributes").fetch("availableInNewTerritories"),
      "selected_territories" => actual, "legal_answers_modified" => false, "verified_at" => Time.now.utc.iso8601}
    FoldingRelease.atomic_json(File.join(FoldingRelease::ROOT, "build/tips/app-availability.json"), report)
    progress("app availability verified: #{actual.length} selected territories")
    report
  rescue StandardError => error
    fail_cleanly(error, "app_availability", api)
  end
end
