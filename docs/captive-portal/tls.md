# Captive-portal TLS: Let's Encrypt via Cloudflare DNS-01 (www-q002.13 → www-j934)

The captive portal is a **LAN-only** service (no Cloudflare tunnel; reachable on
the Mini's LAN IP via UniFi split-horizon DNS, see the [migration design §5a](../k3s-migration/DESIGN.md)).
But the guest WLAN is **open**, so HTTPS on `app--cp.worldwidewebb.co` is non-negotiable:
a guest typing a WiFi password over plain HTTP on an open network is unacceptable. The
legacy `captive-portal.worldwidewebb.co` name stays on the cert during cutover. We need a
**publicly-trusted** cert (so no device shows a warning) for hosts that take **no inbound
public traffic**.

That combination is exactly what **ACME DNS-01** solves: the challenge is answered
by writing a TXT record in the Cloudflare zone, not by serving a file over HTTP-01.
No port 80, no inbound reachability, no public exposure required, only outbound API
calls to Let's Encrypt and to the Cloudflare DNS API.

> **History.** This was originally an `acme.sh` (`dns_cf`) one-shot Swarm job run by
> bosun's scheduler, writing the cert to a shared named volume that the portal nginx
> mounted read-only, with a self-reload loop and a bosun `certProbe`. The whole
> mechanism below replaces that with cert-manager under k3s.

## Mechanism (cert-manager)

- **Issuer:** Let's Encrypt, ACME **DNS-01**, via a cert-manager **`ClusterIssuer`**.
- **Controller:** [cert-manager](https://cert-manager.io) running in-cluster (declared
  in `infra/`). It owns issuance AND renewal continuously (no cron, no one-shot job):
  it re-issues automatically inside the `renewBefore` window before the 90-day expiry.
- **DNS provider auth:** the Cloudflare API token resolved from 1Password,
  `op://Homelab/Cloudflare API/credential`, the SAME account-owned token the Pulumi
  cloudflare provider uses to reconcile tunnel ingress/DNS. ESO syncs it into the k8s
  Secret the `ClusterIssuer`'s `cloudflare` DNS-01 solver references. The token is
  **never** committed, baked into an image, or logged. (It is account-owned, so it is
  verified via `GET /accounts/{account_id}/tokens/verify`, not the user endpoint.)
- **Cert storage:** cert-manager writes the issued cert + key into a k8s `Secret`
  cluster-side. The portal Deployment mounts that Secret into the nginx container, which
  terminates TLS from it. The private key lives only in etcd + the mounted Secret.

## Issuance + renewal

A cert-manager **`Certificate`** resource covers `app--cp.worldwidewebb.co` and legacy
`captive-portal.worldwidewebb.co`, then references the DNS-01 `ClusterIssuer`. cert-manager
issues it once and then renews it continuously inside the `renewBefore` window, writing the
refreshed cert back into the same Secret. There is no scheduled job and no always-on
acme.sh container; renewal is the cert-manager controller's own reconcile loop.

## nginx picks up a renewed cert

When cert-manager rotates the Secret, the mounted cert files in the portal nginx
container update (projected Secret volumes refresh). The portal nginx re-reads the cert
on a periodic `nginx -s reload` from its entrypoint (nginx caches certs at worker
start), so a renewed cert is picked up within hours, harmless lag. No docker-socket
access and no privileged signalling are involved. (The self-reload loop is implemented
in the portal image, www-q002.2.)

## Health: cert-expiry lookahead

cert-manager surfaces the `Certificate` status (Ready, `notAfter`, renewal state)
natively, so a stuck renewal is visible via `kubectl get certificate` well before the
cert goes invalid. The probe does a TLS connect to the public hostname, which only
resolves once the UniFi local DNS records (`app--cp.worldwidewebb.co` and legacy
`captive-portal.worldwidewebb.co → Mini LAN IP`) exist, so health is sequenced with DNS to
avoid a red purely from deploy ordering.
