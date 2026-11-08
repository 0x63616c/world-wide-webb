mock_provider "cloudflare" {}

variables {
  account_id    = "00000000000000000000000000000000"
  zone_id       = "11111111111111111111111111111111"
  allowed_email = "test@example.invalid"
}

run "retained_routes_are_gated" {
  command = plan
  assert {
    condition     = toset(keys(cloudflare_dns_record.home)) == toset(["ha", "hindsight", "bambuddy", "dsm", "penpot", "beszel"])
    error_message = "Only retained independent homelab services may be published."
  }
  assert {
    condition     = keys(cloudflare_zero_trust_access_application.home) == keys(cloudflare_dns_record.home)
    error_message = "Every published hostname must have an Access application."
  }
  assert {
    condition     = cloudflare_zero_trust_tunnel_cloudflared_config.home.config.ingress[length(local.origins)].service == "http_status:404"
    error_message = "Tunnel ingress must terminate in a deny catchall."
  }
}

run "native_api_is_not_published" {
  command = plan
  assert {
    condition     = !contains(keys(cloudflare_dns_record.home), "api") && !contains(keys(cloudflare_dns_record.home), "app")
    error_message = "The native app must be accessible only through Tailscale, never a public Cloudflare hostname."
  }
}
