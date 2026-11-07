mock_provider "cloudflare" {}

variables {
  account_id    = "00000000000000000000000000000000"
  zone_id       = "11111111111111111111111111111111"
  allowed_email = "test@example.invalid"
}

run "retained_routes_are_gated" {
  command = plan
  assert {
    condition     = toset(keys(cloudflare_dns_record.home)) == toset(["api", "app", "ha", "hindsight", "bambuddy", "dsm"])
    error_message = "All retained homelab routes and transitional app hostname must remain declared."
  }
  assert {
    condition     = keys(cloudflare_zero_trust_access_application.home) == keys(cloudflare_dns_record.home)
    error_message = "Every published hostname must have an Access application."
  }
  assert {
    condition     = length(cloudflare_zero_trust_access_policy.devices) == 0
    error_message = "No empty service-token policy may be created."
  }
  assert {
    condition     = cloudflare_zero_trust_tunnel_cloudflared_config.home.config.ingress[6].service == "http_status:404"
    error_message = "Tunnel ingress must terminate in a deny catchall."
  }
}

run "retire_only_app" {
  command = plan
  variables { retain_legacy_app = false }
  assert {
    condition     = toset(keys(cloudflare_dns_record.home)) == toset(["api", "ha", "hindsight", "bambuddy", "dsm"])
    error_message = "Retiring the web app must leave every other route intact."
  }
}
