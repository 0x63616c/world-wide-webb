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
    unsafe = %w[
      SPACESHIP_DEBUG
      SPACESHIP_PROXY
      SPACESHIP_PROXY_SSL_VERIFY_NONE
      VERBOSE
      DEBUG
    ]
    if unsafe.any? { |name| ENV[name] && !ENV[name].empty? }
      raise "Disable request debugging/proxy overrides before Apple account operations"
    end

    value =
      Spaceship::ConnectAPI::Client.auth(
        key_id: ENV.fetch("ASC_KEY_ID"),
        issuer_id: ENV.fetch("ASC_ISSUER_ID"),
        key: ENV.fetch("ASC_PRIVATE_KEY"),
        duration: 600,
        in_house: false
      )
    %i[
      provisioning_request_client
      tunes_request_client
      test_flight_request_client
      users_request_client
    ].each { |name| value.public_send(name).logger = Logger.new(File::NULL) }
    value
  end

  def self.inventory(client: self.client)
    %w[production].to_h do |environment|
      entry = config.fetch(environment)
      app =
        Spaceship::ConnectAPI::App.find(
          entry.fetch("bundle_id"),
          client: client
        )
      bundles =
        ["bundle_id"].to_h do |kind|
          identifier = entry.fetch(kind)
          bundle =
            Spaceship::ConnectAPI::BundleId.find(identifier, client: client)
          [
            kind,
            bundle &&
              {
                "id" => bundle.id,
                "identifier" => bundle.identifier,
                "seed_id" => bundle.seed_id,
                "capabilities" =>
                  bundle
                    .get_capabilities(client: client)
                    .map do |capability|
                      {
                        "type" => capability.capability_type,
                        "settings" => capability.settings
                      }
                    end
              }
          ]
        end
      [
        environment,
        {
          "app" =>
            app &&
              {
                "id" => app.id,
                "name" => app.name,
                "bundle_id" => app.bundle_id
              },
          "bundles" => bundles
        }
      ]
    end
  end

  def self.register_bundles(client: self.client)
    %w[production].each do |environment|
      entry = config.fetch(environment)
      { "bundle_id" => entry.fetch("name") }.each do |kind, name|
        identifier = entry.fetch(kind)
        bundle =
          Spaceship::ConnectAPI::BundleId.find(identifier, client: client)
        unless bundle
          Spaceship::ConnectAPI::BundleId.create(
            client: client,
            name: name,
            platform: "IOS",
            identifier: identifier
          )
          bundle =
            Spaceship::ConnectAPI::BundleId.find(identifier, client: client)
        end
        unless bundle && bundle.identifier == identifier
          raise "Bundle registration was not confirmed"
        end
      end
    end
    inventory(client: client)
  end

  # APP_ATTEST requires separate portal setup: its creation request failed through the public API.
  # Enabling a capability does not register/associate its group or container.
  # Never remove existing services or silently rewrite their settings.
  def self.configure_capabilities(client: self.client)
    app_services = {
      "APP_GROUPS" => [],
      "PUSH_NOTIFICATIONS" => [],
      "IN_APP_PURCHASE" => [],
      "ICLOUD" => [{ key: "ICLOUD_VERSION", options: [{ key: "XCODE_6" }] }],
      "APPLE_ID_AUTH" => [
        {
          key: "APPLE_ID_AUTH_APP_CONSENT",
          options: [{ key: "PRIMARY_APP_CONSENT" }]
        }
      ]
    }
    %w[production].each do |environment|
      entry = config.fetch(environment)
      { "bundle_id" => app_services }.each do |kind, services|
        bundle =
          Spaceship::ConnectAPI::BundleId.find(
            entry.fetch(kind),
            client: client
          )
        raise "Register bundle identifiers first" unless bundle
        existing =
          bundle.get_capabilities(client: client).map(&:capability_type)
        services.each do |type, settings|
          unless existing.include?(type)
            bundle.create_capability(type, settings: settings, client: client)
          end
        end
        actual = bundle.get_capabilities(client: client)
        unless (services.keys - actual.map(&:capability_type)).empty?
          raise "Capability readback incomplete"
        end
        services.each do |type, settings|
          next if settings.empty?
          observed =
            actual
              .find { |capability| capability.capability_type == type }
              .settings || []
          settings.each do |setting|
            value = observed.find { |item| item["key"] == setting[:key] }
            options = value && value["options"] || []
            expected = setting[:options].map { |option| option[:key] }
            selected =
              options
                .select { |option| option["enabled"] != false }
                .map { |option| option["key"] }
            unless (expected - selected).empty?
              raise "Capability settings need explicit reconciliation"
            end
          end
        end
      end
    end
    inventory(client: client)
  end
  # Trusted one-time setup only. Ordinary archive lanes remain readonly.
  def self.bootstrap_signing(context:)
    require "securerandom"
    if ENV.fetch("MATCH_PASSWORD", "").empty?
      raise "MATCH_PASSWORD must come from the project vault"
    end
    client # Reject unsafe debug/proxy configuration before handling Apple credentials.
    team = "X9E4HG27NK"
    keychain = "folding-signing-setup-#{SecureRandom.hex(8)}"
    password = SecureRandom.hex(32)
    identifiers =
      %w[production].flat_map do |environment|
        entry = config.fetch(environment)
        [entry.fetch("bundle_id")]
      end
    begin
      context.create_keychain(
        name: keychain,
        password: password,
        default_keychain: false,
        unlock: true,
        timeout: 3600,
        lock_when_sleeps: true
      )
      context.match(
        type: "appstore",
        readonly: false,
        app_identifier: identifiers,
        git_url: "https://github.com/0x63616c/certificates.git",
        git_branch: "folding",
        team_id: team,
        api_key: {
          key_id: ENV.fetch("ASC_KEY_ID"),
          issuer_id: ENV.fetch("ASC_ISSUER_ID"),
          key: ENV.fetch("ASC_PRIVATE_KEY"),
          duration: 600,
          in_house: false
        },
        keychain_name: keychain,
        keychain_password: password
      )
      evidence =
        %w[production].to_h do |environment|
          entry = config.fetch(environment)
          profiles =
            %w[bundle_id].to_h do |kind|
              bundle = entry.fetch(kind)
              path = ENV.fetch("sigh_#{bundle}_appstore_profile-path")
              profile = FastlaneCore::ProvisioningProfile.parse(path)
              entitlements = profile.fetch("Entitlements")
              unless profile.fetch("TeamIdentifier") == [team]
                raise "Wrong signing team"
              end
              if profile["ProvisionedDevices"] ||
                   entitlements["get-task-allow"] == true
                raise "Not an App Store profile"
              end
              unless entitlements["application-identifier"] ==
                       "#{team}.#{bundle}"
                raise "Wrong profile application"
              end
              unless entitlements["com.apple.security.application-groups"] ==
                       [entry.fetch("app_group")]
                raise "Wrong App Group association"
              end
              if kind == "bundle_id"
                unless entitlements[
                         "com.apple.developer.icloud-container-identifiers"
                       ] == [entry.fetch("cloudkit_container")]
                  raise "Wrong CloudKit association"
                end
                unless Array(
                         entitlements[
                           "com.apple.developer.devicecheck.appattest-environment"
                         ]
                       ).include?("production")
                  raise "Missing production App Attest permission"
                end
                unless entitlements["aps-environment"] == "production"
                  raise "Wrong push signing environment"
                end
              end
              [
                kind,
                {
                  "uuid" => profile.fetch("UUID"),
                  "name" => profile.fetch("Name"),
                  "bundle_id" => bundle,
                  "expires_at" => profile.fetch("ExpirationDate").to_s
                }
              ]
            end
          [environment, profiles]
        end
      directory = File.expand_path("../../build/signing", __dir__)
      FileUtils.mkdir_p(directory)
      File.write(
        File.join(directory, "profile-inventory.json"),
        JSON.pretty_generate(evidence) + "\n"
      )
      evidence
    ensure
      context.delete_keychain(name: keychain)
    end
  end
end
