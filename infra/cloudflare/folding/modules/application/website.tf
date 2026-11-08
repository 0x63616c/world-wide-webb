variable "website_routes_enabled" {
  type    = bool
  default = false
}
locals {
  website_host  = var.environment == "production" ? "getfolding.app" : "staging.getfolding.app"
  website_hosts = var.environment == "production" ? toset([local.website_host, "www.getfolding.app"]) : toset([local.website_host])
}
resource "cloudflare_dns_record" "website" {
  for_each = var.website_routes_enabled ? local.website_hosts : toset([])
  zone_id  = var.zone_id
  name     = each.value
  type     = "AAAA"
  content  = "100::"
  proxied  = true
  ttl      = 1
}
resource "cloudflare_workers_route" "website" {
  for_each   = var.website_routes_enabled ? local.website_hosts : toset([])
  zone_id    = var.zone_id
  pattern    = "${each.value}/*"
  script     = "folding-web-${var.environment}"
  depends_on = [cloudflare_dns_record.website]
}
# This root owns the zone's dynamic redirect phase. Import/preserve any existing
# phase ruleset before enabling; never replace unrelated domain rules.
resource "cloudflare_ruleset" "website_redirect" {
  count   = var.environment == "production" && var.website_routes_enabled ? 1 : 0
  zone_id = var.zone_id
  name    = "Folding canonical website"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"
  rules = [{
    ref         = "folding_www_to_apex"
    action      = "redirect"
    expression  = "http.host eq \"www.getfolding.app\""
    description = "Preserve paths and queries on the canonical HTTPS website"
    enabled     = true
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url            = { expression = "concat(\"https://getfolding.app\", http.request.uri.path)" }
      }
    }
  }]
}
