# Credential bootstrap is IaC too. Only this provider receives the token-minter key.
variable "token_minter" {
  type      = string
  sensitive = true
}
variable "zone_id" { type = string }
provider "cloudflare" {
  alias     = "token_minter"
  api_token = var.token_minter
}
resource "cloudflare_account_token" "deployment" {
  provider   = cloudflare.token_minter
  account_id = var.account_id
  name       = "Folding owner-operated deployment"
  policies = [
    {
      effect = "allow"
      permission_groups = [
        { id = "ad7a6f88896d498f98eb30592abfbbf4" }, # Access: Apps Write
        { id = "e9e3e5ccdebf43dbb1c9576fe74dfaab" }, # Access: Policies Write
        { id = "09b2857d1c31407795e75e3fed8617a1" }, # D1 Write
        { id = "366f57075ffc42689627bcf8242a1b6d" }, # Queues Write
        { id = "bf7481a1826f439697cb59a20b22293e" }, # Workers R2 Storage Write
        { id = "e086da7e2179491d91ee5f35b3ca210a" }, # Workers Scripts Write
      ]
      resources = jsonencode({ "com.cloudflare.api.account.${var.account_id}" = "*" })
    },
    {
      effect = "allow"
      permission_groups = [
        { id = "4755a26eedb94da69e1066d98aa820be" }, # DNS Write
        { id = "79b3ec0d10ce4148a8f8bdc0cc5f97f2" }, # Email Routing Rules Write
        { id = "28f4b596e7d643029c524985477ae49a" }, # Workers Routes Write
        { id = "c8fed203ed3043cba015a93ad1616f1f" }, # Zone Read
        { id = "3030687196b94b638145a3953da2b699" }, # Zone Settings Write
      ]
      resources = jsonencode({ "com.cloudflare.api.account.zone.${var.zone_id}" = "*" })
    },
  ]
  lifecycle { prevent_destroy = true }
}
output "deployment_token" {
  value     = cloudflare_account_token.deployment.value
  sensitive = true
}
output "deployment_token_id" { value = cloudflare_account_token.deployment.id }
