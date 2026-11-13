# Existing Home Assistant runtime

The migration target remains Home Assistant Container in a dedicated Colima VM,
not HA OS. `homelab.homeassistant.enable` defaults to false on both hosts.
The future `haos.enable` option still rejects enablement.

Read-only inspection on 2026-11-03 confirmed the mini uses VZ/aarch64, 2 CPUs,
2 GiB memory, a 12 GiB data disk and 8 GiB root disk. The imported Compose file
retains its image digest, external `ha_config` volume and `ha0` default-route
readiness check. No live configuration was changed.

The new module has three boot daemons:

1. Root runs the Homebrew `socket_vmnet` helper and exposes a socket to the
   `_containers` group. This does not grant that account sudo access.
2. `_containers` waits until it can connect to the socket, then runs the HA VM
   in the foreground. Its own `COLIMA_HOME` is
   `/var/lib/_containers/.colima-ha`, separate from the general service VM.
3. `_containers` waits for Docker and checks that restored `ha_config` exists
   before reconciling the imported Compose file. Missing data fails closed.

The separate home is deliberate: Lima's override lives under
`$COLIMA_HOME/_lima/_config/override.yaml` and would otherwise affect other VMs.
See the [Colima FAQ](https://colima.run/docs/faq/) and
[socket_vmnet CLI source](https://github.com/lima-vm/socket_vmnet/blob/master/cli.c).

Before enabling, identify the target's physical LAN interface and set
`homelab.homeassistant.bridgeInterface` explicitly. The mini currently uses
`en1`; that is not evidence for the MacBook. Arrange a non-conflicting temporary
HA address for restore testing, keep integrations that issue real-world actions
disabled during validation, and stop the old instance before transferring its
production address and deployment ownership. Never boot two copies of the
production HA state on the LAN.

This is a draft runtime implementation. CI compilation does not establish that
Homebrew installation, socket permissions, bridged DHCP, discovery, headless
boot or data restoration works on the target. Those checks and backup/update
coordination remain prerequisites for activation. The runtime must not be
started on either home machine during repository authoring.
