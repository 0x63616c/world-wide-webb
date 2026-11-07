terraform {
  required_version = ">= 1.13, < 1.14"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.24.0"
    }
  }
  # CI executes on the mini; all runs share this backend's OS-level lock.
  # The production path is supplied outside the checkout at init time.
  backend "local" {}
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
provider "cloudflare" {}
