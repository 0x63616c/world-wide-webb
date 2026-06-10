# Captive-portal runbook (www-q002)

How the guest-WiFi captive portal is wired on the network side, what was done
programmatically via the UniFi controller API, and the human steps that remain.
Companion to `docs/captive-portal/PRD.md` and `docs/captive-portal/tls.md`.

## Live controller state (read-only probe, www-q002.15, 2026-06-10)

Captured BEFORE any change, via the UniFi controller API
(`X-API-KEY: op://Homelab/UniFi/local_api_key`, `https://192.168.0.1`):

- **Controller:** UniFi Network `10.4.57` (UniFi OS Cloud Gateway Fiber).
- **Site:** one site, `internalReference: default` (id `88f7af54-98f8-306a-a1c7-c9349722b1f6`).
- **WLANs today:** exactly one, `world-wide-webb` (WPA-PSK, `is_guest: false`,
  enabled). **No `www-guest` WLAN exists**, it would be CREATED (gated, below).
- **Networks:** two WANs + one corporate LAN `Default` (`192.168.0.1/24`). **No
  separate guest network / VLAN exists.**
- **Guest portal (`guest_access` setting, _id `69334b751c01c943e7e9a928`):**
  `portal_enabled: true`, `auth: none`, `redirect_https: true`,
  `portal_customized: false`, `redirect_enabled: false`, `redirect_url: ""`.
  LAN-protection `restricted_subnet_{1,2,3}` = the RFC1918 ranges (default).
- **Local DNS:** `GET /proxy/network/v2/api/site/default/static-dns` → `[]`
  (works; no records yet, this is where the split-horizon record goes).

## Programmatic config (UniFi API)

> STATUS: STAGED, NOT YET APPLIED. Every write below changes real network
> behavior on an open guest SSID, so it is gated on Calum's explicit go-ahead
> (per the ticket). The read-only probe above is done; the writes are not.

API base: `https://192.168.0.1/proxy/network`, header `X-API-KEY: <local_api_key>`.
Private API under `/api/s/default/...`; newer collections under
`/v2/api/site/default/...`.

### 1a. DHCP reservation for the Mini (ADDITIVE, prerequisite for the DNS record)

The Mini (`homelab`) is the known-user record `_id 6934a5aa428b6c14e973b63d`,
MAC `ba:5d:f7:ba:d0:9d`, last-seen `192.168.0.147` (confirmed live via mDNS
`homelab.local`). It has **no DHCP reservation** (`use_fixedip: null`), so the
lease could churn, so the split-horizon DNS record must point at a STABLE IP. Pin
the current IP as a reservation first:

```
PUT /proxy/network/api/s/default/rest/user/6934a5aa428b6c14e973b63d
{ "use_fixedip": true, "fixed_ip": "192.168.0.147", "network_id": "69334b751c01c943e7e9a93a" }
```

(network_id is the `Default` 192.168.0.1/24 LAN.)

### 1b. Local DNS record (split-horizon, ADDITIVE)

`captive-portal.worldwidewebb.co → 192.168.0.147` so the public hostname resolves
to the Mini on the LAN only (the public wildcard hits a dead Cloudflare route).
The `v2/api/site/default/static-dns` collection is confirmed working (GET → 200,
currently empty).

```
POST /proxy/network/v2/api/site/default/static-dns
{ "enabled": true, "record_type": "A", "key": "captive-portal.worldwidewebb.co",
  "value": "192.168.0.147" }
```

### 2. External portal + walled garden (ADDITIVE: one field set + one allow-list)

The external-portal redirect lives on the `guest_access` setting (confirmed keys
include `auth`, `redirect_enabled`, `redirect_url`, `template_engine`). Point the
guest portal at the LAN portal host:

```
POST /proxy/network/api/s/default/set/setting/guest_access/69334b751c01c943e7e9a928
{ ...existing guest_access..., "auth": "hotspot", "redirect_enabled": true,
  "redirect_url": "https://captive-portal.worldwidewebb.co",
  "template_engine": "angular" }   # external-portal mode; exact field set
                                    # CONFIRMED AT APPLY against 10.4.57
```

Walled garden (pre-auth allow for the portal host + DNS): the `rest/portalconf`
collection EXISTS (returns `api.err.InvalidObject` on a bare GET, i.e. present but
needs the right shape, NOT 404), but the exact allow-list write payload on
10.4.57 must be confirmed interactively at apply-time before sending. This is the
ONE staged write whose exact body is not yet pinned read-only.

### 3. Guest WLAN `www-guest` with external portal (GATED, DO NOT APPLY WITHOUT GO)

Create the open/guest WLAN pointing its external portal at
`https://captive-portal.worldwidewebb.co`, with the redirect carrying the
`mac`/`ap`/`ssid`/`t`/`url` params the portal flow consumes. `guest_access` would
flip to external-portal mode (`redirect_enabled: true`, the external URL set).

> GATE: creating/enabling `www-guest` flips live network behavior on an OPEN
> SSID. Requires Calum's explicit approval. The exact param contract (how the
> redirect URL templates mac/ap/ssid/t/url) is validated on a real pre-auth
> client during cutover (www-q002.17).

## Human steps (Calum)

1. **WiFi password:** run `scripts/save-wifi-guest.sh` (already added) to store the
   guest SSID + password in 1Password (`WiFi Guest Credentials`). The api/worker
   read `WIFI_PASSWORD` from there to validate a guest's entry. Then set that SAME
   password on the `www-guest` WLAN in the UniFi console (the controller stores its
   own copy; the two must match).
2. **Resend:** run `scripts/save-resend.sh` when ready for real email (the mock
   sender logs + stores the code until then).
3. **Confirm the Mini's LAN IP** (static/reserved) for the DNS record above.
4. **Approve the WLAN creation** before the agent applies step 3 (WLAN). It
   changes live network behavior.

## Cutover (www-q002.17)

Real phone on `www-guest`, full flow with a real email: pre-auth redirect lands on
`https://captive-portal.worldwidewebb.co` with the expected params, code verifies,
WiFi password checks, `authorize-guest` grants 30 days, browser redirects to the
original URL, and a `portal_authorization` row exists. Verify the cert is the real
Let's Encrypt cert (not the self-signed placeholder) and the certProbe is green.


## Monorepo gotcha: new workspace → touch every Dockerfile (www-q002.2)

Adding a workspace to this monorepo (a new `apps/<x>` or `packages/<x>` with a
`package.json`) puts it in the root `bun.lock`. Every Dockerfile that runs an
in-container `bun install --frozen-lockfile` (api, web, worker, media-worker,
storybook, bosun) COPYs an explicit list of workspace manifests BEFORE installing
and the frozen install fails with "lockfile had changes" if that list is missing
the new workspace's `package.json`. This silently breaks ALL those image builds (and
the prod deploy) for a reason unrelated to the new app. When you add a workspace,
add `COPY <ws>/package.json <ws>/` (matching each file's COPY style) to every
workspace-installing Dockerfile. A mechanical guard enforces this:
`packages/bosun/test/dockerfile-manifests.test.ts` fails CI if any
frozen-installing Dockerfile omits a workspace manifest.
