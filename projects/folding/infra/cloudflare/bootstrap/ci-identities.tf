# Separate CI consumers from the owner-operated infrastructure identity. Cloudflare's
# account-scoped service permissions apply only to the named products, not DNS/Access.
resource "cloudflare_account_token" "ci_deployment" {
  provider   = cloudflare.token_minter
  account_id = var.account_id
  name       = "Folding WWW production deployment"
  policies = [
    {
      effect = "allow"
      permission_groups = [
        { id = "d7ba8d4dce414197a3efab21b2f87eb8" }, # Workers Editor: existing Workers only
        { id = "09b2857d1c31407795e75e3fed8617a1" }, # D1 Write: checksum migrations/recovery bookmarks
        { id = "366f57075ffc42689627bcf8242a1b6d" }, # Queues Write: Wrangler consumer configuration
      ]
      resources = jsonencode({ "com.cloudflare.api.account.${var.account_id}" = "*" })
    },
    {
      effect = "allow"
      permission_groups = [
        { id = "28f4b596e7d643029c524985477ae49a" }, # Workers Routes Write
        { id = "c8fed203ed3043cba015a93ad1616f1f" }, # Zone Read
      ]
      resources = jsonencode({ "com.cloudflare.api.account.zone.${var.zone_id}" = "*" })
    },
  ]
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_account_token" "ci_release_policy" {
  provider   = cloudflare.token_minter
  account_id = var.account_id
  name       = "Folding WWW published-build policy"
  policies = [{
    effect = "allow"
    permission_groups = [
      { id = "da1261c3d38544a4bba805b22566f8b6" }, # Workers Metadata Read-Only: version/deployment receipts
      { id = "09b2857d1c31407795e75e3fed8617a1" }, # D1 Write: immutable published_builds registration
    ]
    resources = jsonencode({ "com.cloudflare.api.account.${var.account_id}" = "*" })
  }]
  lifecycle { prevent_destroy = true }
}

output "ci_deployment_token" {
  value     = cloudflare_account_token.ci_deployment.value
  sensitive = true
}
output "ci_release_policy_token" {
  value     = cloudflare_account_token.ci_release_policy.value
  sensitive = true
}
