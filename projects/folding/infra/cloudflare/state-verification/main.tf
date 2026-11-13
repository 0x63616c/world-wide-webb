terraform {
  required_version = "= 1.13.9"
  backend "s3" {
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
# This deliberately holds the backend lock without changing any cloud resources.
resource "terraform_data" "lock_probe" {
  input = "folding-r2-lock-and-restore-v1"
  provisioner "local-exec" {
    command = "python3 -c 'import time; print(\"FOLDING_LOCK_HELD\", flush=True); time.sleep(20)'"
  }
}
