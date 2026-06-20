import type { Plugin } from "@opencode-ai/plugin"

const PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  // -- Age secret keys (corrected: handles PQ, H1, etc. variants) --
  { label: "age_secret_key", pattern: /AGE-SECRET-KEY-[A-Z0-9]{2,}-1[A-Za-z0-9]{58}/g },

  // -- GitHub token family --
  { label: "github_pat", pattern: /ghp_[A-Za-z0-9]{36,}/g },
  { label: "github_oauth", pattern: /gho_[A-Za-z0-9]{36,}/g },
  { label: "github_app_token", pattern: /ghu_[A-Za-z0-9]{36,}/g },
  { label: "github_app_install", pattern: /ghs_[A-Za-z0-9]{36,}/g },
  { label: "github_fine_grained", pattern: /github_pat_[A-Za-z0-9_]{22,}/g },

  // -- GitLab token family --
  { label: "gitlab_pat", pattern: /glpat-[A-Za-z0-9\-_]{20,}/g },
  { label: "gitlab_pipeline_trigger", pattern: /glptt-[A-Za-z0-9\-_]{20,}/g },
  { label: "gitlab_deploy_token", pattern: /gldt-[A-Za-z0-9\-_]{20,}/g },

  // -- AWS --
  { label: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
  {
    label: "aws_secret_key",
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY|SecretAccessKey)[=:\s"']+([A-Za-z0-9/+=]{40})/g,
  },

  // -- AI providers --
  { label: "anthropic_key", pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g },
  { label: "openai_project_key", pattern: /sk-proj-[A-Za-z0-9\-_]{20,}/g },
  { label: "openai_key", pattern: /sk-(?!ant-)(?!proj-)[A-Za-z0-9]{20,}/g },
  { label: "cohere_key", pattern: /co-[A-Za-z0-9]{30,}/g },
  { label: "huggingface_token", pattern: /hf_[A-Za-z0-9]{30,}/g },

  // -- Google Cloud --
  { label: "google_api_key", pattern: /AIza[0-9A-Za-z\-_]{35}/g },
  { label: "google_oauth_secret", pattern: /GOCSPX-[A-Za-z0-9\-_]{28}/g },
  { label: "gcloud_access_token", pattern: /ya29\.[A-Za-z0-9\-_]{50,}/g },
  { label: "google_refresh_token", pattern: /1\/\/[A-Za-z0-9\-_]{40,}/g },

  // -- Cloud infrastructure --
  { label: "digitalocean_pat", pattern: /dop_v1_[a-f0-9]{64}/g },
  { label: "digitalocean_oauth", pattern: /doo_v1_[a-f0-9]{64}/g },
  { label: "hashicorp_vault", pattern: /hvs\.[A-Za-z0-9]{24,}/g },
  { label: "vercel_token", pattern: /vercel_[A-Za-z0-9]{24,}/g },

  // -- SaaS --
  { label: "slack_token", pattern: /xox[bpors]-[A-Za-z0-9-]{10,}/g },
  {
    label: "slack_webhook",
    pattern: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
  },
  { label: "sendgrid_key", pattern: /SG\.[A-Za-z0-9\-_]{22,}\.[A-Za-z0-9\-_]{22,}/g },
  { label: "postman_key", pattern: /PMAK-[A-Za-z0-9-]{50,}/g },

  // -- Payments --
  { label: "stripe_secret", pattern: /sk_(?:test|live)_[A-Za-z0-9]{10,}/g },
  { label: "stripe_restricted", pattern: /rk_(?:test|live)_[A-Za-z0-9]{10,}/g },
  { label: "stripe_webhook", pattern: /whsec_[A-Za-z0-9]{32,}/g },

  // -- Package registries --
  { label: "npm_token", pattern: /npm_[A-Za-z0-9]{36,}/g },
  { label: "pypi_token", pattern: /pypi-[A-Za-z0-9\-_]{50,}/g },

  // -- Auth tokens --
  { label: "jwt", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { label: "bearer_token", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g },
  {
    label: "private_key",
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|ED25519\s+|DSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|ED25519\s+|DSA\s+)?PRIVATE\s+KEY-----/g,
  },

  // -- Database URLs --
  {
    label: "database_url",
    pattern: /(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+/g,
  },

  // -- Observability --
  { label: "grafana_api_key", pattern: /glc_[A-Za-z0-9\-_]{32,}/g },
  { label: "doppler_token", pattern: /dp\.st\.[A-Za-z0-9_-]{40,}/g },

  // -- Shopify --
  { label: "shopify_access_token", pattern: /shpat_[a-fA-F0-9]{20,}/g },
  { label: "shopify_custom_app", pattern: /shpca_[a-fA-F0-9]{20,}/g },

  // -- Additional SaaS --
  { label: "linear_api_key", pattern: /lin_api_[A-Za-z0-9]{40,}/g },
  { label: "pulumi_token", pattern: /pul-[a-f0-9]{40}/g },
  { label: "docker_pat", pattern: /dckr_pat_[A-Za-z0-9\-_]{24,}/g },

  // -- SSH public keys --
  { label: "ssh_public_key", pattern: /ssh-(?:rsa|ed25519|dss)\s+[A-Za-z0-9+/]{60,}={0,2}/g },

  // -- Generic env var secrets (last -- most generic) --
  {
    label: "env_secret",
    pattern: /(?:PASSWORD|PASSWD|SECRET|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH_TOKEN|ENCRYPTION_KEY|SIGNING_KEY|DB_PASSWORD|DATABASE_PASSWORD)\s*[=:]\s*["']?([^\s"']{8,})["']?/gi,
  },
]

const REDACT_OUTPUT_TOOLS = ["bash", "read", "grep", "webfetch"]
const UNREDACT_ARGS_TOOLS = ["bash", "write", "edit"]
const MIN_SECRET_LENGTH = 8

interface Vault {
  store(label: string, value: string): string
  scrubText(text: string): string
  unscrubText(text: string): string
}

function createVault(): Vault {
  const mapping = new Map<string, string>()
  let counter = 0

  return {
    store(label: string, value: string): string {
      if (value.length < MIN_SECRET_LENGTH) return value
      const existing = [...mapping.entries()].find(([, v]) => v === value)
      if (existing) return existing[0]
      const token = `__SR_${label.toUpperCase()}_${counter++}__`
      mapping.set(token, value)
      return token
    },
    scrubText(text: string): string {
      let result = text
      for (const [token] of mapping) {
        result = result.replaceAll(token, `[REDACTED:${token}]`)
      }
      return result
    },
    unscrubText(text: string): string {
      let result = text
      for (const [token, value] of mapping) {
        result = result.replaceAll(token, value)
      }
      return result
    },
  }
}

function detectSecrets(text: string): Array<{ label: string; value: string }> {
  const results: Array<{ label: string; value: string }> = []
  for (const { label, pattern } of PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const value = match[0]
      if (value.length >= MIN_SECRET_LENGTH) {
        results.push({ label, value })
      }
    }
  }
  return results
}

function redactDeep(value: unknown, vault: Vault): unknown {
  if (typeof value === "string") {
    const detected = detectSecrets(value)
    let result = value
    for (const secret of detected) {
      const token = vault.store(secret.label, secret.value)
      result = result.replaceAll(secret.value, token)
    }
    return result
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, vault))
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = redactDeep(val, vault)
    }
    return result
  }
  return value
}

function unredactDeep(value: unknown, vault: Vault): unknown {
  if (typeof value === "string") return vault.unscrubText(value)
  if (Array.isArray(value)) return value.map((item) => unredactDeep(item, vault))
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = unredactDeep(val, vault)
    }
    return result
  }
  return value
}

export default (async () => {
  const vaults = new Map<string, Vault>()

  function getVault(sessionId?: string): Vault {
    const key = sessionId || "default"
    if (!vaults.has(key)) vaults.set(key, createVault())
    return vaults.get(key)!
  }

  return {
    "tool.execute.after": async (input, output) => {
      if (!REDACT_OUTPUT_TOOLS.includes(input.tool)) return
      const sessionKey = (output as any).metadata?.sessionID || "default"
      const vault = getVault(sessionKey)
      const before = output.output
      output.output = redactDeep(output.output, vault) as string
      if (before !== output.output) {
        console.log(`[secret-redactor] Redacted secrets in ${input.tool} output`)
      }
    },
    "tool.execute.before": async (input, output) => {
      if (!UNREDACT_ARGS_TOOLS.includes(input.tool)) return
      const sessionKey = (output as any).metadata?.sessionID || "default"
      const vault = getVault(sessionKey)
      output.args = unredactDeep(output.args, vault) as typeof output.args
    },
  }
}) satisfies Plugin
