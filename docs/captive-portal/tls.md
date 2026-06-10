# Captive-portal TLS — Let's Encrypt via Cloudflare DNS-01 (www-q002.13)

The captive portal is a **LAN-only** service (no Cloudflare tunnel; reachable on
the Mini's LAN IP via UniFi split-horizon DNS — see www-q002.12/.14/.15). But the
guest WLAN is **open**, so HTTPS on `captive-portal.worldwidewebb.co` is
non-negotiable: a guest typing a WiFi password over plain HTTP on an open network
is unacceptable. We need a **publicly-trusted** cert (so no device shows a warning)
for a host that takes **no inbound public traffic**.

That combination is exactly what **ACME DNS-01** solves: the challenge is answered
by writing a TXT record in the Cloudflare zone, not by serving a file over HTTP-01.
No port 80, no inbound reachability, no public exposure required — only outbound
API calls to Let's Encrypt and to the Cloudflare DNS API.

## Mechanism

- **Issuer:** Let's Encrypt, ACME DNS-01.
- **Client:** [`acme.sh`](https://github.com/acmesh-official/acme.sh) (`neilpang/acme.sh`
  image) with its built-in `dns_cf` plugin. Small, shell-based, no daemon — a clean
  fit for a one-shot Swarm job.
- **DNS provider auth:** the Cloudflare API token resolved at runtime from
  1Password, `op://Homelab/Cloudflare API/credential` — the SAME token bosun
  already uses to reconcile tunnel routes/DNS. acme.sh's `dns_cf` reads it from the
  `CF_Token` env var (token mode; it auto-discovers the zone, so no zone id needed).
  The token is **never** committed, baked into an image, or logged.
- **Cert storage:** issued cert + key land on a **shared named volume**
  (`portal-certs`). The cert job mounts it read-write to write
  `fullchain.pem` + `key.pem`; the portal nginx mounts it **read-only** and
  terminates TLS from it. The private key lives only on that volume on the box.

## Issuance + renewal as a bosun `cronJob()`

Both issuance and renewal run through the same bosun-native scheduler that runs
`docker-image-prune` and `map-extract` — a one-shot Swarm job
(`docker service create --mode replicated-job`), no third-party scheduler, no
always-on container. acme.sh is idempotent and renewal-aware: it only re-issues
when the cert is inside its renewal window (~30 days before the 90-day expiry), so
running the job on a frequent-but-cheap cron (daily) is safe — most runs are a
no-op that exits immediately.

The cert job needs the CF API token as **env at create time**. cronJob() gained
op-resolved secret support for this (www-q002.13): a cron job may declare
`secrets: fromOp(...)`, and the bosun agent resolves them via its OpProvider and
injects them as `--env KEY=VALUE` on the `docker service create` for that run.

> **Tradeoff (documented, accepted):** because the value is injected as a job
> `--env`, it is visible in `docker service inspect <job>` on the box. On this
> single-user homelab that is acceptable; the value is never written to the repo
> and never logged. See `packages/bosun/README.md` (scheduled jobs) for the full
> note.

### The acme.sh job command (reference)

```
acme.sh --issue --dns dns_cf \
  -d captive-portal.worldwidewebb.co \
  --keylength ec-256 \
  --cert-file   /certs/cert.pem \
  --key-file    /certs/key.pem \
  --fullchain-file /certs/fullchain.pem \
  --server letsencrypt
```

On renewal runs the same `--issue` is a no-op until inside the window; `acme.sh`
keeps its own account/state on the volume. (The exact flags + image tag are wired
in deploy.config.ts in www-q002.14, alongside the `portal-certs` volume and the
portal service that consumes it.)

## nginx picks up a renewed cert without privileged signalling

A renewed cert on the volume is inert until nginx re-reads it (nginx caches certs
at worker start). Rather than grant the cert job docker-socket access to send nginx
a signal (wrong privilege shape for a cert job — it would have full docker control),
the **portal nginx container reloads itself**: its entrypoint runs nginx plus a
background loop that issues `nginx -s reload` every few hours. A cert renewed up to
~30 days before expiry is therefore picked up within hours — harmless lag. The cert
job stays a plain, unprivileged acme.sh + volume writer. (The self-reload loop is
implemented in the portal image, www-q002.2.)

## Health: cert-expiry lookahead

`certProbe(host, { warnDays: 14 })` (bosun) goes red ~14 days **before** expiry —
early enough that a stuck renewal is visible while there is still time to fix it,
not after the cert has already gone invalid. It is added to the portal service's
`health` probes in **www-q002.15**, not here: certProbe does a TLS connect to the
public hostname, which only resolves once the UniFi local DNS record
(`captive-portal.worldwidewebb.co → Mini LAN IP`) exists. Sequencing it with that
DNS record keeps the probe from being red purely by deploy ordering.
