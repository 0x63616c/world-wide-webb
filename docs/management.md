# Managing the homelab

Use the public [homelab CLI](https://github.com/0x63616c/homelab-cli) from your
personal Mac. This private repository contains configuration, not a second copy
of the operator application.

## Everyday entry point

Run `homelab`. Choose a host with **↑ / ↓**; **Enter** connects and opens setup.
**i** inspects without changing the host; **d** opens the full result; **q** quits.
The repository attachment and host binding are remembered.

Setup has three stages: **Connect → Prepare → Review & set up**. See
[setup](setup.md) for the one-time target settings and configuration review.

## Authentication

| Connection | Credential |
| --- | --- |
| Operator → GitHub | Local GitHub CLI login, used to read the private manifest |
| Operator → host | SSH key, including keys held by the local 1Password SSH agent |
| Operator → Tailscale API | Scoped OAuth credential from local 1Password, or manual hidden input |
| Host → GitHub | Separate repository-read token provisioned for that host |
| Host secrets | Host-specific age identity; recovery identity stays off nodes |

The 1Password integration is an adapter behind a small credential-source
interface. Automated tests substitute synthetic credentials; they do not access
your vault. No password manager or reusable OAuth client secret is installed on
a node.

## What happens remotely

The CLI uses ordinary SSH. It ships a native bootstrap helper and assembles a
private review bundle from the exact selected Git commit; no local Nix or
compiler is required. The target checks fetched manifest and evaluated Nix facts
against your approved review before installing keys or activating.

The CLI does not need a permanent node agent. Launchd owns boot services and
scheduled jobs. A persistent operation service for reconnectable progress/logs
is a possible later feature, not part of this release.

## Safety and recovery

Saved host-key changes are blocked. Secret values never enter command arguments
or UI diagnostics. Interrupted setup journals are preserved and uncertain phases
cannot resume blindly. Existing legacy preparation needs an explicit repository
binding before reuse; switching repositories cannot silently reuse its keys.

A bootstrap is not a service cutover. Verify Tailscale, reboot/startup and recovery
before moving production services. Wiping either Mac always needs separate approval.
