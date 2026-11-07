locals {
  origins = {
    ha        = { service = "http://192.168.0.130:8123", no_tls_verify = false }
    hindsight = { service = "http://127.0.0.1:9999", no_tls_verify = false }
    bambuddy  = { service = "http://127.0.0.1:8000", no_tls_verify = false }
    dsm       = { service = "https://192.168.0.218:5001", no_tls_verify = true }
  }
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "home" {
  account_id = var.account_id
  name       = "world-wide-webb"
  config_src = "cloudflare"
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_zero_trust_access_policy" "email" {
  account_id       = var.account_id
  name             = "home-email-otp"
  decision         = "allow"
  session_duration = "720h"
  include          = [{ email = { email = var.allowed_email } }]
}

resource "cloudflare_zero_trust_access_application" "home" {
  for_each                   = local.origins
  account_id                 = var.account_id
  name                       = "${each.key}.${var.zone_name}"
  domain                     = "${each.key}.${var.zone_name}"
  type                       = "self_hosted"
  http_only_cookie_attribute = true
  session_duration           = "720h"
  tags                       = ["bosun:control-center"]
  policies                   = [{ id = cloudflare_zero_trust_access_policy.email.id, precedence = 2 }]
}

resource "cloudflare_zero_trust_access_policy" "deny" {
  count      = var.apply_access_gate ? 1 : 0
  account_id = var.account_id
  name       = "home-default-deny"
  decision   = "deny"
  include    = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "floor" {
  count                      = var.apply_access_gate ? 1 : 0
  account_id                 = var.account_id
  name                       = "*.${var.zone_name}"
  domain                     = "*.${var.zone_name}"
  type                       = "self_hosted"
  http_only_cookie_attribute = true
  session_duration           = "720h"
  tags                       = ["bosun:control-center"]
  policies                   = [{ id = cloudflare_zero_trust_access_policy.deny[0].id, precedence = 99 }]
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "home" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.home.id
  config = {
    ingress = concat([
      for host, origin in local.origins : {
        hostname       = "${host}.${var.zone_name}"
        service        = origin.service
        origin_request = { no_tls_verify = origin.no_tls_verify }
      }
    ], [{ service = "http_status:404" }])
  }
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_dns_record" "home" {
  for_each = local.origins
  zone_id  = var.zone_id
  name     = "${each.key}.${var.zone_name}"
  type     = "CNAME"
  content  = "${cloudflare_zero_trust_tunnel_cloudflared.home.id}.cfargotunnel.com"
  proxied  = true
  ttl      = 1
  # Never publish a host before its Access application has been established.
  depends_on = [cloudflare_zero_trust_access_application.home]
}

output "tunnel_id" {
  value     = cloudflare_zero_trust_tunnel_cloudflared.home.id
  sensitive = true
}
output "access_audiences" {
  value     = { for host, app in cloudflare_zero_trust_access_application.home : host => app.aud }
  sensitive = true
}
