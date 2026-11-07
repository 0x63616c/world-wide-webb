terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.24.0"
    }
  }
  # Bucket, region and key come from a private backend config at init time.
  # AWS S3 conditional writes provide real cross-runner locking.
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}

provider "cloudflare" {}
