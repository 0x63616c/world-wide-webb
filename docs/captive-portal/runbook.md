# Captive-portal runbook (CC-q002)

How the guest-WiFi captive portal is wired on the network side, what was done
programmatically via the UniFi controller API, and the human steps that remain.
Companion to `docs/captive-portal/PRD.md` and `docs/captive-portal/tls.md`.

## Live controller state (read-only probe, CC-q002.15, 2026-06-10)

Captured BEFORE any change, via the UniFi controller API
(`X-API-KEY: op://Homelab/UniFi/local_api_key`, `https://192.168.0.1`):

- **Controller:** UniFi Network `10.4.57` (UniFi OS Cloud Gateway Fiber).
- **Site:** one site, `internalReference: default` (id `88f7af54-98f8-306a-a1c7-c9349722b1f6`).
- **WLANs today:** exactly one — `world-wide-webb` (WPA-PSK, `is_guest: false`,
  enabled). **No `www-guest` WLAN exists** — it would be CREATED (gated, below).
- **Networks:** two WANs + one corporate LAN `Default` (`192.168.0.1/24`). **No
  separate guest network / VLAN exists.**
- **Guest portal (`guest_access` setting, _id `69334b751c01c943e7e9a928`):**
  `portal_enabled: true`, `auth: none`, `redirect_https: true`,
  `portal_customized: false`, `redirect_enabled: false`, `redirect_url: ""`.
  LAN-protection `restricted_subnet_{1,2,3}` = the RFC1918 ranges (default).
- **Local DNS:** `GET /proxy/network/v2/api/site/default/static-dns` → `[]`
  (works; no records yet — this is where the split-horizon record goes).

## Programmatic config (UniFi API)

> STATUS: STAGED, NOT YET APPLIED. Every write below changes real network
> behavior on an open guest SSID, so it is gated on Calum's explicit go-ahead
> (per the ticket). The read-only probe above is done; the writes are not.

API base: `https://192.168.0.1/proxy/network`, header `X-API-KEY: <local_api_key>`.
Private API under `/api/s/default/...`; newer collections under
`/v2/api/site/default/...`.

### 1. Local DNS record (split-horizon) — ADDITIVE

`captive-portal.worldwidewebb.co → <MINI_LAN_IP>` so the public hostname resolves
to the Mini on the LAN only (the public wildcard hits a dead Cloudflare route).

```
POST /proxy/network/v2/api/site/default/static-dns
{ "enabled": true, "record_type": "A", "key": "captive-portal.worldwidewebb.co",
  "value": "<MINI_LAN_IP>" }
```

> BLOCKER: `<MINI_LAN_IP>` is unknown. The Mini (`homelab`) was NOT in the
> controller's active client list during the probe, and the agent cannot shell
> into prod to read it. It MUST be a STATIC/reserved IP for the DNS record to
> stay valid. Needs Calum to confirm the Mini's LAN IP + that it is DHCP-reserved
> or statically set.

### 2. Walled garden (pre-auth allow) — ADDITIVE

A pre-auth client must reach the portal host (and DNS) before authorizing. The
exact walled-garden / external-portal collection on Network 10.4.57 was NOT
confirmed read-only during the probe (the classic `rest/portalconf` /
`firewallgroup` paths 404 on this version; the model was reworked). Resolve the
correct endpoint against the UniFi Network 10.x API before writing.

### 3. Guest WLAN `www-guest` with external portal — GATED, DO NOT APPLY WITHOUT GO

Create the open/guest WLAN pointing its external portal at
`https://captive-portal.worldwidewebb.co`, with the redirect carrying the
`mac`/`ap`/`ssid`/`t`/`url` params the portal flow consumes. `guest_access` would
flip to external-portal mode (`redirect_enabled: true`, the external URL set).

> GATE: creating/enabling `www-guest` flips live network behavior on an OPEN
> SSID. Requires Calum's explicit approval. The exact param contract (how the
> redirect URL templates mac/ap/ssid/t/url) is validated on a real pre-auth
> client during cutover (CC-q002.17).

## Human steps (Calum)

1. **WiFi password:** run `scripts/save-wifi-guest.sh` (already added) to store the
   guest SSID + password in 1Password (`WiFi Guest Credentials`). The api/worker
   read `WIFI_PASSWORD` from there to validate a guest's entry. Then set that SAME
   password on the `www-guest` WLAN in the UniFi console (the controller stores its
   own copy; the two must match).
2. **Resend:** run `scripts/save-resend.sh` when ready for real email (the mock
   sender logs + stores the code until then).
3. **Confirm the Mini's LAN IP** (static/reserved) for the DNS record above.
4. **Approve the WLAN creation** before the agent applies step 3 (WLAN) — it
   changes live network behavior.

## Cutover (CC-q002.17)

Real phone on `www-guest`, full flow with a real email: pre-auth redirect lands on
`https://captive-portal.worldwidewebb.co` with the expected params, code verifies,
WiFi password checks, `authorize-guest` grants 30 days, browser redirects to the
original URL, and a `portal_authorization` row exists. Verify the cert is the real
Let's Encrypt cert (not the self-signed placeholder) and the certProbe is green.


## Monorepo gotcha: new workspace → touch every Dockerfile (CC-q002.2)

Adding a workspace to this monorepo (a new `apps/<x>` or `packages/<x>` with a
`package.json`) puts it in the root `bun.lock`. Every Dockerfile that runs an
in-container `bun install --frozen-lockfile` (api, web, worker, media-worker,
storybook, bosun) COPYs an explicit list of workspace manifests BEFORE installing
— and the frozen install fails with "lockfile had changes" if that list is missing
the new workspace's `package.json`. This silently breaks ALL those image builds (and
the prod deploy) for a reason unrelated to the new app. When you add a workspace,
add `COPY <ws>/package.json <ws>/` (matching each file's COPY style) to every
workspace-installing Dockerfile. A mechanical guard enforces this:
`packages/bosun/test/dockerfile-manifests.test.ts` fails CI if any
frozen-installing Dockerfile omits a workspace manifest.
