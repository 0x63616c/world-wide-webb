terraform {
  required_version = "= 1.13.9"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }
  encryption {
    key_provider "pbkdf2" "bootstrap" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "bootstrap" {
      keys = key_provider.pbkdf2.bootstrap
    }
    state {
      method   = method.aes_gcm.bootstrap
      enforced = true
    }
    plan {
      method   = method.aes_gcm.bootstrap
      enforced = true
    }
  }
}

variable "account_id" {
  type = string
}
variable "state_passphrase" {
  type      = string
  sensitive = true
}

provider "cloudflare" {}

resource "cloudflare_r2_bucket" "state" {
  account_id    = var.account_id
  name          = "folding-infrastructure-state"
  location      = "wnam"
  storage_class = "Standard"
  lifecycle {
    prevent_destroy = true
  }
}
