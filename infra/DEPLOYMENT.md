# Production deployment notes

The `home-server` Pulumi stack pins every workload image by immutable digest.
CI updates the entries it can resolve from GHCR and retains existing pins for
unchanged images or temporarily missing tags. Never clear the complete
`wwwinfra:imageDigests` map during a deployment: doing so can unpin unrelated
workloads and causes the production program to reject an incomplete release.

Retiring an image is a deliberate configuration change, not an inference from
a missing registry tag.

For the WWW-76 consolidation, CI runs `scripts/deploy-www.sh`, which patches
`control-center/api` to `Recreate` and clears `spec.strategy.rollingUpdate` in the same merge patch
(WWW-84). Pulumi's null input alone did not clear the live defaulted field,
causing preview to fail. The patch is safe to repeat and changes no pod template.
It runs before previewing, stopping the legacy worker, and applying the Pulumi
update. The helper restores the legacy worker on failure before www activation;
after activation it keeps that worker stopped to prevent duplicate enforcers.
