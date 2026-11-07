terraform {
  required_version = "= 1.13.9"
  backend "s3" {
    key                         = "folding/production.tfstate"
    bucket                      = "folding-infrastructure-state"
    region                      = "auto"
    endpoints                   = { s3 = "https://eb3ea2e5ef93e58704d39980583fee38.r2.cloudflarestorage.com" }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_lockfile                = true
  }
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}
variable "state_passphrase" {
  type      = string
  sensitive = true
}

provider "cloudflare" {}
variable "zone_id" { type = string }
variable "support_destination" {
  type      = string
  sensitive = true
}
module "support_email" {
  source      = "../../modules/support-email"
  zone_id     = var.zone_id
  destination = var.support_destination
}

variable "account_id" { type = string }
variable "admin_emails" {
  type      = set(string)
  sensitive = true
}
variable "application_routes_enabled" {
  type    = bool
  default = false
}
module "application" {
  source                 = "../../modules/application"
  account_id             = var.account_id
  zone_id                = var.zone_id
  environment            = "production"
  admin_emails           = var.admin_emails
  routes_enabled         = var.application_routes_enabled
  website_routes_enabled = var.website_routes_enabled
}
output "application_bindings" { value = module.application.bindings }

variable "website_routes_enabled" {
  type    = bool
  default = true
}
