"""Retention for one host's dedicated Control Center history namespace."""

import datetime
import json
import re
import shutil
from zoneinfo import ZoneInfo

STAMP = re.compile(r"\d{8}T\d{6}Z-[a-f0-9]{8}")
HOSTS = ("homelab-macbook", "homelab-mac-mini")


def retained(names, weekly=False):
    hours, days, weeks = {}, {}, {}
    for name in sorted(names):
        if not STAMP.fullmatch(name):
            raise ValueError("Invalid history snapshot name")
        when = datetime.datetime.strptime(name[:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
        local = when.astimezone(ZoneInfo("America/Los_Angeles"))
        hours[when.strftime("%Y%m%dT%H")] = name
        days[local.date()] = name
        weeks[local.isocalendar()[:2]] = name
    return set(list(hours.values())[-24:] + list(days.values())[-7:] + (list(weeks.values()) if weekly else []))


def prune_local(root):
    # Unverified/incomplete sets are never retention candidates.
    sets = {
        path.name: path
        for path in root.iterdir()
        if STAMP.fullmatch(path.name)
        and path.is_dir()
        and not path.is_symlink()
        and (path / "NAS_VERIFIED").is_file()
        and not (path / "NAS_VERIFIED").is_symlink()
    }
    for name in set(sets) - retained(sets):
        shutil.rmtree(sets[name])


def namespace(host, scope="control-center-history"):
    if host not in HOSTS:
        raise ValueError("Unknown history host")
    if scope not in ("control-center-history", "deployment"):
        raise ValueError("Unknown retention namespace")
    return "/Homelab/backups/" + host + "/" + scope


def prune_remote(nas, host, verified_stamp, scope="control-center-history", protected=()):
    """Called only after this invocation publishes its verified completion marker."""
    parent = namespace(host, scope)
    if not STAMP.fullmatch(verified_stamp):
        raise ValueError("Invalid newly verified history set")
    names, offset = set(), 0
    while True:
        result = nas.call("SYNO.FileStation.List", "list", folder_path=parent, offset=offset, limit=1000)
        rows = result.get("files", [])
        if not isinstance(rows, list) or type(result.get("total")) is not int:
            raise ValueError("Invalid history listing")
        for row in rows:
            name = row.get("name", "")
            if (
                isinstance(name, str)
                and STAMP.fullmatch(name)
                and row.get("isdir") is True
                and row.get("path") == parent + "/" + name
            ):
                # Presence of a directory alone never makes an incomplete upload
                # eligible for deletion. Probe only the exact completion path.
                complete = parent + "/" + name + "/COMPLETE.json"
                try:
                    info = nas.call("SYNO.FileStation.List", "getinfo", path=json.dumps([complete]))
                except Exception as error:
                    if getattr(error, "code", None) in (400, 408):
                        continue
                    raise
                files = info.get("files", [])
                if any(f.get("path") == complete and f.get("isdir") is False for f in files):
                    names.add(name)
        offset += len(rows)
        if offset >= result["total"]:
            break
        if not rows:
            raise RuntimeError("History listing made no progress")
    if verified_stamp not in names:
        raise RuntimeError("New verified snapshot absent from history listing; expiration skipped")
    if scope == "deployment":
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
        keep = {
            name
            for name in names
            if datetime.datetime.strptime(name[:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc) >= cutoff
        }
        keep.add(verified_stamp)
    else:
        keep = retained(names, weekly=True)
    keep.update(protected)
    # Do not expire the last independent recovery point.
    if scope == "control-center-history" and len(keep) < 2:
        return
    for name in sorted(names - keep):
        path = parent + "/" + name
        if not STAMP.fullmatch(name) or path.rsplit("/", 1)[0] != parent:
            raise ValueError("Unsafe history retention target")
        nas.call("SYNO.FileStation.Delete", "delete", path=json.dumps([path]), recursive="true")
