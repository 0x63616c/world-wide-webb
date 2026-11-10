"""Pure deployment decisions over evaluated, secret-free generation metadata."""

import re

SERVICES = frozenset(("control-center", "bambuddy", "hindsight", "cloudflared", "penpot", "beszel", "golink", "home-assistant"))


def assigned(metadata):
    services = metadata.get("services")
    if (
        not isinstance(services, list)
        or any(not isinstance(s, str) for s in services)
        or len(set(services)) != len(services)
        or set(services) - SERVICES
    ):
        raise ValueError("Invalid service assignment")
    if services and metadata.get("backupsEnabled") is not True:
        raise ValueError("Stateful updates require configured backups")
    return services


def descriptors(metadata):
    value = metadata.get("inputs")
    if not isinstance(value, dict) or value.get("version") != 1:
        return None
    expected = {"host", "safety", "containers", "home-assistant"}
    services = value.get("services", {})
    if set(value) != {"version", "shared", "services"} or set(value.get("shared", {})) != expected:
        raise ValueError("Invalid shared deployment inputs")
    if set(services) != set(assigned(metadata)):
        raise ValueError("Deployment inputs differ from assignments")
    hashes = list(value["shared"].values())
    for entry in services.values():
        if not isinstance(entry, dict) or set(entry) != {"configuration", "storage", "secrets"}:
            raise ValueError("Invalid service deployment inputs")
        hashes.extend(entry.values())
    if any(not isinstance(v, str) or not re.fullmatch("[a-f0-9]{64}", v) for v in hashes):
        raise ValueError("Invalid deployment input digest")
    return value


def plan_deployment(previous, candidate):
    """Return backup/reconcile/health scope; never read state or execute actions."""
    old, new = assigned(previous), assigned(candidate)
    if not previous.get("host") or previous.get("host") != candidate.get("host"):
        raise ValueError("Candidate host differs from the running host")
    if set(old) - set(new):
        raise ValueError("Service removal needs an explicit source-stopped retirement workflow")
    before, after = descriptors(previous), descriptors(candidate)
    reasons = {}
    off_host = False

    def select(names, reason):
        for name in names:
            reasons.setdefault(name, []).append(reason)

    if before is None or after is None:
        select(new, "metadata-transition")
        off_host = True
    else:
        for group in ("host", "safety", "containers", "home-assistant"):
            if before["shared"][group] == after["shared"][group]:
                continue
            affected = (
                new
                if group in ("host", "safety")
                else [s for s in new if (s == "home-assistant") == (group == "home-assistant")]
            )
            select(affected, group)
            off_host = True
        for name in new:
            if name not in old:
                select([name], "assignment")
                continue
            for field in ("configuration", "storage", "secrets"):
                if before["services"][name][field] != after["services"][name][field]:
                    select([name], field)
                    off_host |= field == "storage"
    changed = [s for s in new if s in reasons]
    health = list(changed)
    if "home-assistant" in changed and "control-center" in new and "control-center" not in health:
        health.append("control-center")
    backup = [s for s in old if s in reasons]
    return {
        "format": 1,
        "backup": backup,
        "reconcile": changed,
        "health": health,
        "recovery": ("off-host" if off_host else "local") if backup else "none",
        "reasons": reasons,
        "legacy": before is None,
    }
