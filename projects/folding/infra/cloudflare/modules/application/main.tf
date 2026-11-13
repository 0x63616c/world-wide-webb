terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
  }
}
variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "environment" {
  type = string
  validation {
    condition     = var.environment == "production"
    error_message = "Only production is supported."
  }
}
variable "admin_emails" {
  type      = set(string)
  sensitive = true
  validation {
    condition     = length(var.admin_emails) > 0
    error_message = "An explicit administrator allowlist is required."
  }
}
variable "routes_enabled" {
  type    = bool
  default = false
}
locals {
  api_host    = "api.getfolding.app"
  admin_host  = "admin.getfolding.app"
  worker_name = "folding-api-${var.environment}"
}
resource "cloudflare_d1_database" "application" {
  account_id       = var.account_id
  name             = "folding-${var.environment}"
  read_replication = { mode = "disabled" }
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_r2_bucket" "avatars" {
  account_id = var.account_id
  name       = "folding-avatars-${var.environment}"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_r2_managed_domain" "avatars" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.avatars.name
  enabled     = false
}
resource "cloudflare_queue" "jobs" {
  account_id = var.account_id
  queue_name = "folding-jobs-${var.environment}"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_queue" "dead" {
  account_id = var.account_id
  queue_name = "folding-jobs-dead-${var.environment}"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_zero_trust_access_policy" "administrators" {
  account_id = var.account_id
  name       = "Folding ${var.environment} administrators"
  decision   = "allow"
  include    = [for address in var.admin_emails : { email = { email = address } }]
}
resource "cloudflare_zero_trust_access_application" "admin" {
  account_id           = var.account_id
  name                 = "Folding ${var.environment} admin"
  type                 = "self_hosted"
  domain               = local.admin_host
  session_duration     = "1h"
  app_launcher_visible = false
  policies             = [{ id = cloudflare_zero_trust_access_policy.administrators.id, precedence = 1 }]
}
resource "cloudflare_dns_record" "application" {
  for_each = var.routes_enabled ? toset([local.api_host, local.admin_host]) : toset([])
  zone_id  = var.zone_id
  name     = each.value
  type     = "AAAA"
  content  = "100::"
  proxied  = true
  ttl      = 1
}
resource "cloudflare_workers_route" "application" {
  for_each   = var.routes_enabled ? toset([local.api_host, local.admin_host]) : toset([])
  zone_id    = var.zone_id
  pattern    = "${each.value}/*"
  script     = local.worker_name
  depends_on = [cloudflare_zero_trust_access_application.admin, cloudflare_dns_record.application]
}
output "bindings" {
  value = {
    environment     = var.environment
    account_id      = var.account_id
    worker_name     = local.worker_name
    database_id     = cloudflare_d1_database.application.id
    database_name   = cloudflare_d1_database.application.name
    avatar_bucket   = cloudflare_r2_bucket.avatars.name
    jobs_queue      = cloudflare_queue.jobs.queue_name
    dead_queue      = cloudflare_queue.dead.queue_name
    api_origin      = "https://${local.api_host}"
    admin_origin    = "https://${local.admin_host}"
    access_audience = cloudflare_zero_trust_access_application.admin.aud
  }
}
