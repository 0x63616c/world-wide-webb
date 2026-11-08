terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
  }
}
variable "account_id" { type = string }
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Use staging or production."
  }
}
variable "enabled" {
  type    = bool
  default = false
}
variable "outbound_delivery_verified" {
  type    = bool
  default = false
}
# A separate database remains writable when the application database is unavailable.
resource "cloudflare_d1_database" "watchdog" {
  account_id       = var.account_id
  name             = "folding-watchdog-${var.environment}"
  read_replication = { mode = "disabled" }
  lifecycle { prevent_destroy = true }
}
# Wrangler owns Worker code, bindings and its schedule in one deploy. OpenTofu
# owns only durable infrastructure; never create a second owner for that schedule.
output "bindings" {
  value = {
    account_id                 = var.account_id
    environment                = var.environment
    worker_name                = "folding-watchdog-${var.environment}"
    database_name              = cloudflare_d1_database.watchdog.name
    database_id                = cloudflare_d1_database.watchdog.id
    enabled                    = var.enabled
    outbound_delivery_verified = var.outbound_delivery_verified
  }
}
