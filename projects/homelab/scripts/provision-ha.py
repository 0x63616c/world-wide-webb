#!/usr/bin/env python3
"""Checksum-pinned, non-destructive provisioning of the existing HA volume.

Host entrypoint runs this same implementation inside the pinned HA image. No
host/guest mount paths, new volumes, credentials or live HA API are needed.
"""

import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


RESOURCE = "/local/community/lovelace-xiaomi-vacuum-map-card/xiaomi-vacuum-map-card.js"
BEGIN = "# BEGIN HOMELAB VACUUM "
END = "# END HOMELAB VACUUM "


class ProvisionError(ValueError):
    """Safe diagnostic without configuration contents or credentials."""


def digest(content):
    return hashlib.sha256(content).hexdigest()


def render(templates, config):
    values = {key.upper(): value for key, value in config["entities"].items()}
    for key in ("schedule", "rooms_confirmed", "clean_room"):
        values[key.upper() + "_KEY"] = config["entities"][key].split(".", 1)[1]
    rooms = config["rooms"]
    values["ROOM_OPTIONS"] = [r["id"] for r in rooms]
    values["ROOM_SEGMENTS"] = {r["id"]: r["segment"] for r in rooms}
    modes = [{"template": "vacuum_clean_zone"}]
    if config["rooms_confirmed"]:
        selections = []
        for room in rooms:
            selection = {
                "id": str(room["segment"]),
                "label": {"text": room["name"], "x": room["label_position"][0], "y": room["label_position"][1]},
            }
            if room.get("outline"):
                selection["outline"] = room["outline"]
            selections.append(selection)
        modes.insert(0, {"template": "vacuum_clean_segment", "predefined_selections": selections})
    values["MAP_MODES"] = modes
    output = {}
    for name, template in templates.items():
        for key, value in values.items():
            template = template.replace("__" + key + "__", json.dumps(value))
        if re.search(r"__[A-Z_]+__", template):
            raise ProvisionError("Unresolved vacuum template")
        if name == "vacuum.yaml":
            template = template.replace("initial: false", "initial: " + str(config["rooms_confirmed"]).lower())
        output["homelab-vacuum/" + name] = template.encode()
    return output


def mapping(node):
    import yaml

    if not isinstance(node, yaml.MappingNode):
        raise ProvisionError("HA config must use mappings; include/anchor conflicts need operator review")
    result = {}
    for key, value in node.value:
        if key.value in result:
            raise ProvisionError("Duplicate HA config key; refusing to overwrite")
        result[key.value] = value
    return result


def configuration(text, modern_resources, resources):
    """Keep original text/comments/includes. Only insert marked mapping entries."""
    import yaml

    # Remove only blocks previously inserted by this script. User edits outside
    # these markers remain byte-for-byte intact, including !secret/!include tags.
    lines = text.splitlines(keepends=True)
    clean, active = [], None
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(BEGIN):
            if active is not None:
                raise ProvisionError("Invalid managed markers")
            active = stripped[len(BEGIN) :].strip()
        elif stripped.startswith(END):
            if active != stripped[len(END) :].strip():
                raise ProvisionError("Invalid managed markers")
            active = None
        elif active is None:
            clean.append(line)
    if active is not None:
        raise ProvisionError("Unclosed managed block")
    base = "".join(clean)
    if any(isinstance(token, (yaml.tokens.AnchorToken, yaml.tokens.AliasToken)) for token in yaml.scan(base)):
        raise ProvisionError("HA configuration anchors need operator reconciliation before provisioning")
    root = mapping(yaml.compose(base))
    insertions = {}

    def add(parent, body, label):
        # Insert immediately below a mapping's header (before any existing keys).
        # Refuse flow mappings/aliases: inserting there would alter unrelated YAML.
        if parent is None:
            position, indent = len(clean), 0
        else:
            mapping(parent)
            if parent.flow_style or parent.start_mark.line == parent.end_mark.line:
                raise ProvisionError("Inline HA mapping needs expansion before provisioning")
            position, indent = parent.start_mark.line, parent.start_mark.column
        block = " " * indent + BEGIN + label + "\n"
        block += "".join(" " * indent + line + "\n" for line in body.splitlines())
        block += " " * indent + END + label + "\n"
        insertions.setdefault(position, []).append(block)

    home = root.get("homeassistant")
    if home is None:
        add(
            None,
            "homeassistant:\n  packages:\n    homelab_vacuum: !include homelab-vacuum/vacuum.yaml",
            "package",
        )
    else:
        packages = mapping(home).get("packages")
        if packages is None:
            add(home, "packages:\n  homelab_vacuum: !include homelab-vacuum/vacuum.yaml", "package")
        elif packages.tag == "!include_dir_named":
            directory = PurePosixPath(packages.value)
            if directory.is_absolute() or ".." in directory.parts or not directory.parts:
                raise ProvisionError("Packages directory must be relative to /config")
        else:
            if "homelab_vacuum" in mapping(packages):
                raise ProvisionError("Existing homelab_vacuum package conflicts")
            add(packages, "homelab_vacuum: !include homelab-vacuum/vacuum.yaml", "package")
    lovelace = root.get("lovelace")
    existing = mapping(lovelace) if lovelace else {}
    # Existing dashboards/resources can be included mappings or hand-managed;
    # never replace them or silently switch the existing default dashboard.
    if set(existing) & {"dashboards", "resources", "resource_mode"}:
        raise ProvisionError("Existing Lovelace dashboards/resources need operator reconciliation")
    if "mode" in existing and existing["mode"].value != "storage":
        raise ProvisionError("Existing YAML default dashboard needs operator reconciliation")
    body = (
        "dashboards:\n  dashboard-vacuum:\n    mode: yaml\n    title: Vacuum\n"
        "    icon: mdi:robot-vacuum\n    show_in_sidebar: true\n"
        "    filename: homelab-vacuum/dashboard-vacuum.yaml"
    )
    if modern_resources:
        body += "\nresource_mode: yaml\nresources: " + json.dumps(resources)
    if lovelace is None:
        body = "lovelace:\n" + "\n".join("  " + line for line in body.splitlines())
    add(lovelace, body, "dashboard")
    if not modern_resources:
        # Older HA couples YAML resources to a YAML default dashboard. Load the
        # exact same ES module through HA's declarative frontend loader instead.
        frontend = root.get("frontend")
        if frontend and "extra_module_url" in mapping(frontend):
            raise ProvisionError("Existing frontend modules need operator reconciliation")
        body = "extra_module_url:\n  - " + RESOURCE
        if frontend is None:
            body = "frontend:\n  " + body.replace("\n", "\n  ")
        add(frontend, body, "module")
    result = []
    for index in range(len(clean) + 1):
        if index in insertions:
            if result and not result[-1].endswith("\n"):
                result.append("\n")
            result.extend(insertions[index])
        if index < len(clean):
            result.append(clean[index])
    final = "".join(result)
    mapping(yaml.compose(final))
    return final


def download(asset):
    with urllib.request.urlopen(asset["url"], timeout=60) as response:
        content = response.read(100 * 1024 * 1024 + 1)
    if len(content) > 100 * 1024 * 1024 or digest(content) != asset["sha256"]:
        raise ProvisionError("Release checksum mismatch: " + asset["name"])
    return content


def asset_files(asset, content):
    if digest(content) != asset["sha256"]:
        raise ProvisionError("Release checksum mismatch: " + asset["name"])
    target = asset["target"]
    if not asset["url"].endswith(".zip"):
        return {target: content}
    result = {}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if sum(i.file_size for i in archive.infolist()) > 200 * 1024 * 1024:
            raise ProvisionError("Release archive too large")
        for item in archive.infolist():
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ProvisionError("Unsafe release archive path")
            if not item.is_dir():
                result[target + "/" + str(path)] = archive.read(item)
    if target + "/manifest.json" not in result:
        raise ProvisionError("Missing integration manifest")
    return result


def safe_path(root, relative):
    path = root / relative
    if not path.is_relative_to(root) or ".." in Path(relative).parts:
        raise ProvisionError("Unsafe managed path")
    for ancestor in [path, *path.parents]:
        if ancestor == root:
            break
        if ancestor.is_symlink():
            raise ProvisionError("Symlink in managed HA path")
    return path


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            os.fchmod(output.fileno(), 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def validate_asset_tree(target):
    """Reject links and special files before moving an unowned asset aside."""
    if target.is_symlink():
        raise ProvisionError("Symlink in managed HA path")
    if target.is_dir():
        for path in target.rglob("*"):
            if path.is_symlink():
                raise ProvisionError("Symlink in managed HA path")
            if not path.is_dir() and not path.is_file():
                raise ProvisionError("Managed HA asset must contain only regular files and directories")
    elif target.exists() and not target.is_file():
        raise ProvisionError("Managed HA asset must be a regular file or directory")


def adopted_backup(root, relative):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    base = safe_path(root, ".homelab-vacuum-backups/adopted-" + stamp)
    suffix = 1
    while base.exists():
        base = safe_path(root, ".homelab-vacuum-backups/adopted-" + stamp + "-" + str(suffix))
        suffix += 1
    destination = safe_path(root, str(base.relative_to(root) / relative))
    return destination


def provision(root, bundle, fetch=download, modern_resources=True):
    import yaml

    root = Path(root)
    config = safe_path(root, "configuration.yaml")
    if not root.is_dir() or not config.is_file():
        raise ProvisionError("Restored HA configuration.yaml is required; never create an installation")
    receipt = safe_path(root, ".homelab-vacuum.json")
    previous = json.loads(receipt.read_text()) if receipt.exists() else {}
    pending = safe_path(root, ".homelab-vacuum-pending.json")
    pending_record = json.loads(pending.read_text()) if pending.exists() else {}
    pending_files = pending_record.get("files", pending_record)
    pending_adoptions = pending_record.get("adoptions", {})
    old = previous.get("files", {})
    resource = {"url": RESOURCE, "type": "module"}
    resources = [resource]
    storage = safe_path(root, ".storage/lovelace_resources")
    if storage.exists():
        resources = json.loads(storage.read_text())["data"]["items"]
        resources = [{"url": r["url"], "type": r["type"]} for r in resources if r["url"] != RESOURCE] + [resource]
    desired_config = configuration(config.read_text(), modern_resources, resources).encode()
    fingerprint = digest(json.dumps(bundle, sort_keys=True).encode())
    files = render(bundle["templates"], bundle["vacuum"])
    root_config = mapping(yaml.compose(config.read_text()))
    home = root_config.get("homeassistant")
    packages = mapping(home).get("packages") if home else None
    if packages and packages.tag == "!include_dir_named":
        relative = packages.value.rstrip("/") + "/homelab_vacuum.yaml"
        include = os.path.relpath("homelab-vacuum/vacuum.yaml", packages.value)
        files[relative] = ("!include " + include + "\n").encode()
    adopted = []
    adoption_destinations = dict(pending_adoptions)
    if previous.get("source") == fingerprint:
        for name in old:
            if name not in files:
                target = safe_path(root, name)
                if not target.is_file() or digest(target.read_bytes()) != old[name]:
                    raise ProvisionError("Managed HA asset changed; preserve it and reconcile before retrying: " + name)
                files[name] = target.read_bytes()
    else:
        for asset in bundle["assets"]:
            target = safe_path(root, asset["target"])
            owned = any(n == asset["target"] or n.startswith(asset["target"] + "/") for n in (old | pending_files))
            if target.exists():
                validate_asset_tree(target)
                if asset["target"] in pending_adoptions:
                    adopted.append(asset["target"])
                elif not owned:
                    adopted.append(asset["target"])
                    adoption_destinations[asset["target"]] = str(
                        adopted_backup(root, asset["target"]).relative_to(root)
                    )
            files.update(asset_files(asset, fetch(asset)))
        for relative in pending_adoptions:
            if relative not in adopted:
                adopted.append(relative)
    # Preflight ALL conflicts before mutating any configuration or asset.
    for name in set(old) | set(files):
        target = safe_path(root, name)
        if target.exists() and not any(name == path or name.startswith(path + "/") for path in adopted):
            if not target.is_file():
                raise ProvisionError("Managed HA asset must be a regular file")
            current = digest(target.read_bytes())
            if current not in (old.get(name), pending_files.get(name), digest(files.get(name, b""))):
                raise ProvisionError("HA file modified outside provisioning; refusing to overwrite: " + name)
    changes = [
        n
        for n, b in files.items()
        if any(n == path or n.startswith(path + "/") for path in adopted)
        or not safe_path(root, n).exists()
        or safe_path(root, n).read_bytes() != b
    ]
    removed = set(old) - set(files)
    config_changed = config.read_bytes() != desired_config
    dirty = safe_path(root, ".homelab-vacuum-dirty")
    if changes or removed or config_changed or adopted:
        atomic(dirty, b"restart required\n")
        # Journal ownership before any write: an interrupted first install or
        # upgrade can resume without treating its own partial files as foreign.
        atomic(
            pending,
            json.dumps(
                {
                    "files": {n: digest(b) for n, b in files.items()},
                    "adoptions": adoption_destinations,
                },
                sort_keys=True,
            ).encode(),
        )
        for relative in adopted:
            target = safe_path(root, relative)
            backup = safe_path(root, adoption_destinations[relative])
            if backup.exists():
                continue
            if not target.exists():
                raise ProvisionError("Interrupted HA asset adoption lost both source and backup")
            backup.parent.mkdir(parents=True, exist_ok=True)
            os.rename(target, backup)
        # Private backup contains original configuration (potentially !secret refs).
        # Each content hash retains earlier versions; never replace a backup.
        for name in changes + sorted(removed) + (["configuration.yaml"] if config_changed else []):
            target = safe_path(root, name)
            if target.exists():
                backup = safe_path(root, ".homelab-vacuum-backups/" + digest(target.read_bytes()) + "/" + name)
                if not backup.exists():
                    atomic(backup, target.read_bytes())
        for name in changes:
            atomic(safe_path(root, name), files[name])
        for name in removed:
            safe_path(root, name).unlink(missing_ok=True)
        if config_changed:
            atomic(config, desired_config)
    record = {"source": fingerprint, "files": {n: digest(b) for n, b in files.items()}}
    atomic(receipt, json.dumps(record, sort_keys=True).encode())
    pending.unlink(missing_ok=True)
    return dirty.exists()


def host(bundle_root, vacuum_path):
    import yaml

    bundle = {
        "assets": json.loads((bundle_root / "assets.json").read_text()),
        "templates": {p.name: p.read_text() for p in (bundle_root / "managed").glob("*.yaml")},
        "vacuum": json.loads(vacuum_path.read_text()),
    }
    compose = bundle_root / "compose.yaml"
    image = yaml.safe_load(compose.read_text())["services"]["home-assistant"]["image"]
    subprocess.run(["docker", "volume", "inspect", "ha_config"], check=True, stdout=subprocess.DEVNULL, timeout=30)
    # Inspect the existing volume before mounting; configuration.yaml inside it
    # is independently required before any provisioning writes.
    source = Path(__file__).read_text().rsplit('\nif __name__ == "__main__":', 1)[0]
    source += "\nbundle = " + repr(bundle) + "\n"
    source += """
import importlib.util

try:
    lovelace = importlib.util.find_spec('homeassistant.components.lovelace')
    modern = 'resource_mode' in Path(lovelace.origin).read_text()
    print('restart' if provision(Path('/config'), bundle, modern_resources=modern) else 'unchanged')
except ProvisionError as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
except Exception:
    print('HA config parse, release download or I/O failed; inspect locally without sharing config', file=sys.stderr)
    sys.exit(1)
"""
    container = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--network",
        "bridge",
        "--mount",
        "type=volume,src=ha_config,dst=/config",
        "--entrypoint",
        "python",
        image,
        "-",
    ]
    result = subprocess.run(container, input=source, text=True, capture_output=True, check=False, timeout=600)
    if result.returncode:
        # Config/credentials never enter diagnostics, including parser exceptions.
        raise RuntimeError("HA provisioning failed: " + result.stderr.strip())
    command = ["docker-compose", "-f", str(compose), "up", "-d", "--wait", "--wait-timeout", "240"]
    if result.stdout.strip() == "restart":
        command.append("--force-recreate")
    elif result.stdout.strip() != "unchanged":
        raise RuntimeError("Unexpected HA provisioning result")
    subprocess.run(command, check=True, timeout=360)
    acknowledge = [
        "docker-compose",
        "-f",
        str(compose),
        "exec",
        "-T",
        "home-assistant",
        "python",
        "-c",
        "from pathlib import Path; Path('/config/.homelab-vacuum-dirty').unlink(missing_ok=True)",
    ]
    subprocess.run(acknowledge, check=True, timeout=30)


if __name__ == "__main__":
    host(Path(sys.argv[1]), Path(sys.argv[2]))
