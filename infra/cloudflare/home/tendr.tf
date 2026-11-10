# Tendr owns the site; this existing state owner retains public DNS/routing.
# Wrangler publishes only the named Worker's code and static assets.
resource "cloudflare_dns_record" "tendr" {
  zone_id = var.zone_id
  name    = "tendr.${var.zone_name}"
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
}

resource "cloudflare_workers_route" "tendr" {
  zone_id    = var.zone_id
  pattern    = "tendr.${var.zone_name}/*"
  script     = "tendr-web-production"
  depends_on = [cloudflare_dns_record.tendr]
}
