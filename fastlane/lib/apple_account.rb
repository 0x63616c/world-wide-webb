require "json"
require "logger"
require "spaceship"

module FoldingAppleAccount
  CONFIG_PATH = File.expand_path("../app-identifiers.json", __dir__)

  def self.config
    JSON.parse(File.read(CONFIG_PATH))
  end

  # Credentials enter through the primary agent's existing secret session or a trusted
  # release environment. Never serialize keys, JWTs or raw HTTP requests to an artifact.
  def self.client
    unsafe = %w[SPACESHIP_DEBUG SPACESHIP_PROXY SPACESHIP_PROXY_SSL_VERIFY_NONE VERBOSE DEBUG]
    raise "Disable request debugging/proxy overrides before Apple account operations" if unsafe.any? { |name| ENV[name] && !ENV[name].empty? }

    value = Spaceship::ConnectAPI::Client.auth(
      key_id: ENV.fetch("ASC_KEY_ID"), issuer_id: ENV.fetch("ASC_ISSUER_ID"),
      key: ENV.fetch("ASC_PRIVATE_KEY"), duration: 600, in_house: false
    )
    %i[provisioning_request_client tunes_request_client test_flight_request_client users_request_client].each do |name|
      value.public_send(name).logger = Logger.new(File::NULL)
    end
    value
  end

  def self.inventory(client: self.client)
    %w[production staging].to_h do |environment|
      entry = config.fetch(environment)
      app = Spaceship::ConnectAPI::App.find(entry.fetch("bundle_id"), client: client)
      bundles = ["bundle_id", "widget_bundle_id"].to_h do |kind|
        identifier = entry.fetch(kind)
        bundle = Spaceship::ConnectAPI::BundleId.find(identifier, client: client)
        [kind, bundle && {"id" => bundle.id, "identifier" => bundle.identifier, "seed_id" => bundle.seed_id,
          "capabilities" => bundle.get_capabilities(client: client).map { |capability| {"type" => capability.capability_type, "settings" => capability.settings} }}]
      end
      [environment, {"app" => app && {"id" => app.id, "name" => app.name, "bundle_id" => app.bundle_id}, "bundles" => bundles}]
    end
  end

  def self.register_bundles(client: self.client)
    %w[production staging].each do |environment|
      entry = config.fetch(environment)
      {"bundle_id" => entry.fetch("name"), "widget_bundle_id" => "#{entry.fetch('name')} Widgets"}.each do |kind, name|
        identifier = entry.fetch(kind)
        bundle = Spaceship::ConnectAPI::BundleId.find(identifier, client: client)
        unless bundle
          Spaceship::ConnectAPI::BundleId.create(
            client: client, name: name, platform: "IOS", identifier: identifier
          )
          bundle = Spaceship::ConnectAPI::BundleId.find(identifier, client: client)
        end
        raise "Bundle registration was not confirmed" unless bundle && bundle.identifier == identifier
      end
    end
    inventory(client: client)
  end

  # APP_ATTEST requires separate portal setup: its creation request failed through the public API.
  # Enabling a capability does not register/associate its group or container.
  # Never remove existing services or silently rewrite their settings.
  def self.configure_capabilities(client: self.client)
    app_services = {
      "APP_GROUPS" => [], "PUSH_NOTIFICATIONS" => [],
      "IN_APP_PURCHASE" => [],
      "ICLOUD" => [{key: "ICLOUD_VERSION", options: [{key: "XCODE_6"}]}],
      "APPLE_ID_AUTH" => [{key: "APPLE_ID_AUTH_APP_CONSENT", options: [{key: "PRIMARY_APP_CONSENT"}]}]
    }
    %w[production staging].each do |environment|
      entry = config.fetch(environment)
      {"bundle_id" => app_services, "widget_bundle_id" => {"APP_GROUPS" => []}}.each do |kind, services|
        bundle = Spaceship::ConnectAPI::BundleId.find(entry.fetch(kind), client: client)
        raise "Register bundle identifiers first" unless bundle
        existing = bundle.get_capabilities(client: client).map(&:capability_type)
        services.each do |type, settings|
          bundle.create_capability(type, settings: settings, client: client) unless existing.include?(type)
        end
        actual = bundle.get_capabilities(client: client)
        raise "Capability readback incomplete" unless (services.keys - actual.map(&:capability_type)).empty?
        services.each do |type, settings|
          next if settings.empty?
          observed = actual.find { |capability| capability.capability_type == type }.settings || []
          settings.each do |setting|
            value = observed.find { |item| item["key"] == setting[:key] }
            options = value && value["options"] || []
            expected = setting[:options].map { |option| option[:key] }
            selected = options.select { |option| option["enabled"] != false }.map { |option| option["key"] }
            raise "Capability settings need explicit reconciliation" unless (expected - selected).empty?
          end
        end
      end
    end
    inventory(client: client)
  end
end
