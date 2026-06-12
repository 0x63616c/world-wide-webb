# Captive-portal runbook (www-q002)

How the guest-WiFi captive portal is wired on the network side, what was done
programmatically via the UniFi controller API, and the human steps that remain.
Companion to `docs/captive-portal/PRD.md` and `docs/captive-portal/tls.md`.

## RESOLVED, external portal LIVE + verified (www-q002.15, 2026-06-12)

The guest WLAN external portal is configured and proven on a real device. The
final config below was set in the UniFi console (Clients -> Hotspot Portal) and
read back from the API. The exact "External Portal Server" field set is NOT
reliably writable blind via the API on this UniFi OS, so it was set in the console
once and codified here.

**`guest_access` (read back, the source of truth for these fields):**

| field | value | meaning |
|---|---|---|
| `auth` | `custom` | External Portal Server mode (NOT `hotspot`/`none`) |
| `portal_enabled` | `true` | portal on |
| `portal_use_hostname` | `true` | redirect to the FQDN, not the raw IP |
| `portal_hostname` | `captive-portal.worldwidewebb.co` | the external portal host |
| `redirect_to_https` | `true` | "Secure Portal", redirect over HTTPS (real LE cert) |
| `ec_enabled` | `false` | "Encrypted URL" OFF, params arrive PLAINTEXT (the SPA reads `id`/`mac` directly; encrypting them as an `ec` blob would break it) |
| `expire` (number/unit) | 30 days | matches `authorize-guest` (43200 min) |

**Walled garden (UI: Hotspot Portal -> Authorization Access):**
- **Pre-Authorization Allowances:** `192.168.0.147` (lets a pre-auth guest reach
  the portal host; the FQDN resolves there via the split-horizon DNS record). No
  standalone walled-garden API endpoint exists on this UniFi OS; it lives in the
  Hotspot Portal config.
- **Post-Authorization Restrictions:** `192.168.0.0/16`, `172.16.0.0/12`,
  `10.0.0.0/8` (default), an authorized guest reaches the internet but NOT the LAN.

**Verified on a real device (2026-06-12):** the captive nginx log shows the iOS
CaptiveNetworkSupport client hitting
`/guest/s/default/?ap=<apmac>&id=<clientmac>&t=<ts>&url=<orig>&ssid=www-guest` ->
HTTP 200. So UniFi's external-portal redirect delivers the `id`(=MAC)/`ap`/`ssid`/
`t`/`url` params the SPA consumes. That satisfies the www-q002.15 redirect-param
requirement; the full guest-completes-the-flow test is the www-q002.17 cutover.

**Re-trigger the portal for testing:** a device stays authorized after passing
once, so unauthorize it first, then force a pre-auth HTTP hit:
```
# unauthorize (API): POST /proxy/network/api/s/default/cmd/stamgr {"cmd":"unauthorize-guest","mac":"<mac>"}
# then on the device: open http://neverssl.com (plain HTTP triggers the captive sheet)
```

**gitops gap (www-j934.17):** `guest_access` is adopted in `infra/unifi` with empty
args, so this console-set config is NOT yet managed by Pulumi (the bridged provider
also shows a fieldless phantom diff on it). Before the unifi stack enters CI,
declare these fields on the Pulumi `GuestAccess` resource.

**Heads-up:** the default LAN was renamed `Default` -> `main` in the console; the
Pulumi adopt may show that as drift on the next preview.

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

## STATUS UPDATE (2026-06-12, www-q002.15 + www-j934.3.2)

The world moved on since the 2026-06-10 plan below: the guest SSID is now **OPEN
(no WPA password)** and the `www-guest` WLAN / network / firewall pinhole are
**created and live via Pulumi** (`infra/unifi`, ticket www-j934.3.2), not staged
curls. Net state:

- **DONE + live:** `www-guest` open WLAN (VLAN 20, `192.168.20.1/24`, client +
  network isolation; UniFi network name `guest`), the cross-VLAN firewall pinhole
  `guest -> 192.168.0.147:80,443` (idx 22000), the Mini `.147` DHCP reservation,
  and the split-horizon DNS record `captive-portal.worldwidewebb.co -> 192.168.0.147`.
  The portal app answers HTTP 200 at both `https://192.168.0.147/` and the hostname.
- **WiFi-password step is GONE:** www-guest is open, so `scripts/save-wifi-guest.sh`
  / mirroring a WLAN password no longer applies. Access is gated by the portal, not
  a passphrase.

### Apple Captive Network Assistant compatibility (www-q002.26)

The iOS captive sheet uses Apple's Captive Network Assistant (CNA), not Safari.
In real-device logs it fetched `/guest/s/default/` with a `CaptiveNetworkSupport`
UA but did not request the Vite module bundle, CSS, fonts, or API. The production
portal therefore must keep both:

- Vite legacy output: `@vitejs/plugin-legacy` emits `nomodule` scripts plus
  `vite-legacy-polyfill` and `vite-legacy-entry`.
- CNA classic loader: `index.html` includes a plain classic script,
  `script_cna_legacy_loader`, which waits briefly and then loads the legacy
  polyfill + entry if the modern React entry did not set `window.__ccPortalBooted`.

Do not convert the CNA loader to module syntax or modern-only JS. It is deliberately
ES5-style because it exists for the WebView path that skipped the module entry.

### External-portal flip: BLOCKED on a 30-second console step (by design)

The one remaining network change, pointing the guest portal at
`https://captive-portal.worldwidewebb.co`, could NOT be pinned safely via the API.
Findings (probed live, then reverted to baseline; no lasting change):

- The raw `guest_access` field that means "redirect a PRE-auth client to our
  external page" is **ambiguous on UniFi OS 10.4.57**. A trial write of
  `auth:hotspot` + `redirect_enabled:true` + `redirect_url:<our URL>` was accepted
  (`rc:ok`) but the `@pulumiverse/unifi` `GuestAccess.redirect.url` field is
  documented as the **post-authentication** redirect, not the pre-auth landing, and
  the provider's separate `authUrl` ("URL for authentication") maps to no field
  present in the default object. The `auth` valid-values list is truncated in the
  schema. Guessing here misconfigures the live portal in a way only a real device
  reveals, so the trial write was **reverted to the captured baseline**
  (`auth:none`, `redirect_enabled:false`) and the Pulumi adopt re-verified clean
  (`pulumi preview --refresh` = 11 unchanged).
- **No standalone walled-garden endpoint** exists on this controller version
  (`rest/portalconf` -> `api.err.InvalidObject`; no `portal`/`garden` key in
  `get/setting`). For an external portal UniFi auto-allows the redirect host + DNS
  pre-auth; the explicit firewall pinhole already covers guest -> `.147`.

**Unblock (Calum, ~30s in the UniFi console):** Guest Hotspot settings -> set the
authentication / portal type to **External Portal Server** and point it at
`https://captive-portal.worldwidewebb.co`. Leave it set. Then the agent reads back
the EXACT `guest_access` (+ any walled-garden) fields UniFi wrote and codifies them
here (and, for gitops, declares them on the Pulumi `GuestAccess` resource, see
below). This console-then-readback was always the plan; the API ambiguity confirms
it is the safe path.

### Pulumi management of `guest_access` (gitops, ref www-j934.17)

`guest_access` is adopted in `infra/unifi` with **empty args** (`{}`), so a direct
API change drifts it (the bridged provider then shows a fieldless phantom update;
a blind `pulumi up` on the unifi stack could even reset the setting). Before the
unifi stack is wired into CI gitops (www-j934.17), the external-portal config must be
**declared on the Pulumi `GuestAccess` resource** (the provider exposes `auth`,
`authUrl`, `redirect`, `redirectEnabled`, `portalCustomization`, etc.) so it is
managed, not adopted-empty. Until then do NOT `pulumi up` the unifi stack without
`--refresh` and a careful guest_access diff.

---

## Programmatic config (UniFi API), original 2026-06-10 plan (superseded above)

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
> client during cutover (www-q002.17).

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
storybook, drizzle, captive-portal) COPYs an explicit list of workspace manifests
BEFORE installing and the frozen install fails with "lockfile had changes" if that
list is missing the new workspace's `package.json`. This silently breaks ALL those
image builds (and the prod deploy) for a reason unrelated to the new app. When you
add a workspace, add `COPY <ws>/package.json <ws>/` (matching each file's COPY
style) to every workspace-installing Dockerfile.

## LAN exposure + cutover (www-q002.21 → www-j934)

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
3. UniFi (www-q002.15, Calum + agent): set the guest WLAN external-portal redirect → `https://captive-portal.worldwidewebb.co`, walled-garden allow the portal host + DNS, create the `www-guest` WLAN (changes live WiFi). Already done: Mini/HomeTB reservations + the split-horizon DNS record.
4. Real-device test (www-q002.17): a phone on `www-guest` is captive-redirected, completes the flow, gets 30-day internet.
