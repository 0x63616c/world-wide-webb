# Captive-portal runbook (CC-q002)

How the guest-WiFi captive portal is wired on the network side, what was done
programmatically via the UniFi controller API, and the human steps that remain.
Companion to `docs/captive-portal/PRD.md` and `docs/captive-portal/tls.md`.

## Live controller state (read-only probe, CC-q002.15, 2026-06-10)

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

> STATUS (2026-06-10): writes 1a (reservation) + 1b (DNS) APPLIED by team-lead with
> Calum's explicit approval. Writes 2 (external portal), 4 (walled garden), 5 (WLAN)
> are STAGED, NOT YET APPLIED, gated on Calum (live-gateway mutation needs the
> user's authorization, not a peer GO). APPLIED:
> - 1a reservation: PUT rest/user/6934a5aa428b6c14e973b63d, read-back use_fixedip:true
>   fixed_ip:192.168.0.147 for MAC ba:5d:f7:ba:d0:9d (HTTP 200).
> - 1b static DNS: record _id 6a293c1c37f85e778afb60a2, A
>   captive-portal.worldwidewebb.co to 192.168.0.147. Split-horizon VERIFIED from a
>   LAN client: dig @192.168.0.1 answers 192.168.0.147, dig @1.1.1.1 answers
>   Cloudflare (172.67.154.130 / 104.21.82.73), system resolver answers .147.
> - NOTE: the LAN DNS answer lagged ~20s after the write (dnsmasq reload). Expect a
>   short propagation delay after any static-dns change before LAN clients see it.

API base: `https://192.168.0.1/proxy/network`, header `X-API-KEY: <local_api_key>`.
Private API under `/api/s/default/...`; newer collections under
`/v2/api/site/default/...`.

### 1a. DHCP reservation for the Mini (ADDITIVE, prerequisite for the DNS record)

The Mini (`homelab`) is the known-user record `_id 6934a5aa428b6c14e973b63d`,
MAC `ba:5d:f7:ba:d0:9d`. It has **no DHCP reservation** (`use_fixedip: null`).
Target verified three ways: mDNS `homelab.local` answers `192.168.0.147` and pings;
ARP from a LAN host maps `192.168.0.147` to that exact MAC; so does an ARP for
`192.168.0.38`, where the controller's active-client list ALSO shows that MAC. The
lease is therefore ALREADY drifting between `.147` and `.38`, which is exactly why
the reservation is needed before the DNS record. Pin the MAC to `.147`:

```
PUT /proxy/network/api/s/default/rest/user/6934a5aa428b6c14e973b63d
{ "use_fixedip": true, "fixed_ip": "192.168.0.147", "network_id": "69334b751c01c943e7e9a93a" }
```

(network_id is the `Default` 192.168.0.1/24 LAN.)

> **CAVEAT (durable fix is a Calum action, not optional):** the Mini is on **WiFi**
> (`is_wired: false`, SSID `world-wide-webb`) with a **private/randomized MAC**
> (OUI `ba:5d:f7` is locally-administered). A reservation pinned to that MAC holds
> ONLY while macOS keeps the private address fixed for this network. macOS default
> is "Fixed" per-network, but a "Rotating" setting or a network re-join can change
> the MAC and SILENTLY break both the reservation and the DNS target. Durable fix,
> Calum to do ONE of: (a) wire the Mini to ethernet (stable hardware MAC), or
> (b) set the Mini's `world-wide-webb` WiFi private-address mode to **Fixed**. Do
> this before relying on the captive portal long-term.

> **AUTHORIZATION:** these are writes to the LIVE shared UniFi gateway. The agent's
> harness BLOCKS them on a peer-teammate GO alone (Modify-Shared-Resources requires
> the actual user). So Calum applies them (console or the staged curls), or grants
> an explicit session permission. A team-lead GO is not sufficient.

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
> client during cutover (CC-q002.17).

## Human steps (Calum)

1. **WiFi password:** run `scripts/save-wifi-guest.sh` (already added) to store the
   guest SSID + password in 1Password (`WiFi Guest Credentials`). The api/worker
   read `WIFI_PASSWORD` from there to validate a guest's entry. Then set that SAME
   password on the `www-guest` WLAN in the UniFi console (the controller stores its
   own copy; the two must match).
2. **Resend:** run `scripts/save-resend.sh` when ready for real email (the mock
   sender logs + stores the code until then).
3. **Authorize the UniFi writes.** The reservation + DNS record (writes 1a/1b) are
   staged + target-verified but BLOCKED on Calum: the harness won't let the agent
   mutate the live gateway on a peer GO alone. Apply them in the console, run the
   staged curls, or grant a session permission.
4. **Stabilize the Mini's WiFi MAC** (durable fix for the reservation, see the
   caveat in section 1a): wire the Mini to ethernet OR set its `world-wide-webb`
   WiFi private-address mode to Fixed, so the reserved MAC can't rotate away.
5. **Approve + create the WLAN** (write 5) before the portal goes live. It changes
   live network behavior on an open SSID. While in the console setting the portal
   type to External Portal Server, leave it set so the agent can read back the exact
   `guest_access` + walled-garden payloads (writes 3/4) instead of guessing them.

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
storybook, drizzle, captive-portal) COPYs an explicit list of workspace manifests
BEFORE installing and the frozen install fails with "lockfile had changes" if that
list is missing the new workspace's `package.json`. This silently breaks ALL those
image builds (and the prod deploy) for a reason unrelated to the new app. When you
add a workspace, add `COPY <ws>/package.json <ws>/` (matching each file's COPY
style) to every workspace-installing Dockerfile.

## LAN exposure + cutover (CC-q002.21 → CC-j934)

Under k3s the portal is exposed by a **`Service type: LoadBalancer`** on `:443`/`:80`.
OrbStack's "Expose services to local network devices" (`expose_services`) republishes
those ports on the mini's LAN NIC (en1, 192.168.0.147), the host LAN IP the
split-horizon DNS record already points at. nginx terminates TLS on `:443` with the
cert-manager-issued cert and passes only `/api/trpc/portal.*` through to `api`. The
[migration design §5a](../k3s-migration/DESIGN.md) proved this with a LAN curl returning
HTTP 200. (Previously, under Swarm, OrbStack would not forward published ports to the
LAN, so the portal needed a `portal-edge` overlay + a plain-container nginx-stream L4
proxy `scripts/portal-lan.sh`; both are retired by the LoadBalancer + `expose_services`
path. `scripts/portal-lan.sh` is deleted at cutover.)

**Cutover steps (in order):**
1. `pulumi up --stack prod` brings up the captive-portal Deployment + its LoadBalancer Service; confirm OrbStack `expose_services` is ON.
2. Verify from a LAN device: `curl -k https://192.168.0.147:443/` and `https://captive-portal.worldwidewebb.co/` return the SPA; `/api/trpc/portal.status` reaches the api; `/api/trpc/lights.list` + a mixed batch return 404.
3. UniFi (CC-q002.15, Calum + agent): set the guest WLAN external-portal redirect → `https://captive-portal.worldwidewebb.co`, walled-garden allow the portal host + DNS, create the `www-guest` WLAN (changes live WiFi). Already done: Mini/HomeTB reservations + the split-horizon DNS record.
4. Real-device test (CC-q002.17): a phone on `www-guest` is captive-redirected, completes the flow, gets 30-day internet.
