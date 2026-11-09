terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }
}

variable "zone_id" {
  type = string
}

variable "destination" {
  type      = string
  sensitive = true
}

resource "cloudflare_email_routing_dns" "routing" {
  zone_id = var.zone_id
  # Omit name for the zone apex; Cloudflare treats an explicit name as a subdomain.

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_email_routing_rule" "support" {
  zone_id = var.zone_id
  name    = "Folding support"
  enabled = true
  matchers = [{
    type  = "literal"
    field = "to"
    value = "support@getfolding.app"
  }]
  actions = [{
    type  = "forward"
    value = [var.destination]
  }]
  depends_on = [cloudflare_email_routing_dns.routing]
}
