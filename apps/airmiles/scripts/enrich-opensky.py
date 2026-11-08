#!/usr/bin/env python3
"""Match local history to the public 2019–2022 OpenSky research dataset.

Keep downloads/results private and respect the dataset's LICENSE.txt. This helper
only emits tracking observations, never scheduled/actual gate times or delays.
Unknown flight numbers remain review candidates, even if just one is observed.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import urllib.request
from zoneinfo import ZoneInfo

RECORD = "https://zenodo.org/api/records/7923702"
SOURCE = "https://zenodo.org/records/7923702"
# Deliberately explicit: unsupported airports/carriers are skipped, not guessed.
AIRPORTS = {
    "LAX": ("KLAX", "America/Los_Angeles"), "SFO": ("KSFO", "America/Los_Angeles"),
    "SEA": ("KSEA", "America/Los_Angeles"), "LAS": ("KLAS", "America/Los_Angeles"),
    "MCO": ("KMCO", "America/New_York"), "JFK": ("KJFK", "America/New_York"),
    "AUS": ("KAUS", "America/Chicago"), "LHR": ("EGLL", "Europe/London"),
    "LGW": ("EGKK", "Europe/London"), "SEN": ("EGMC", "Europe/London"),
    "AMS": ("EHAM", "Europe/Amsterdam"),
    "BCN": ("LEBL", "Europe/Madrid"), "LTN": ("EGGW", "Europe/London"),
}
CARRIERS = {"Virgin Atlantic": ("VS", ("VIR",)), "Air New Zealand": ("NZ", ("ANZ",)),
            "Delta": ("DL", ("DAL",)), "United": ("UA", ("UAL", "SKW",)),
            "American": ("AA", ("AAL",)), "Frontier": ("F9", ("FFT",)),
            "easyJet": ("U2", ("EZY", "EJU", "EZS")),
            "Norwegian": (("DY", "DI", "D8"), ("NAX", "NRS", "NLH", "IBK", "NSZ"))}


def key_for(f):
    return "|".join(f[k] for k in ("date", "airline", "flight", "from", "to"))


def instant(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Tracking timestamps must have a timezone")
    return parsed


def normalize_number(value):
    match = re.fullmatch(r"([A-Z0-9]{2})0*(\d+)", value.strip().upper())
    return (match[1], int(match[2])) if match else None


def exact_identity(flight, row):
    """Caller already checked local day and both airports; require known carrier/number.

    Prefer numeric ATC callsigns. Alphanumeric suffixes require the independent
    commercial-number column too. A mismatch in either populated number rejects.
    """
    carrier = CARRIERS.get(flight["airline"])
    number = normalize_number(flight["flight"])
    if not carrier or not number or number[0] not in ((carrier[0],) if isinstance(carrier[0], str) else carrier[0]):
        return False
    call = re.fullmatch(r"([A-Z]{3})0*(\d+)([A-Z]*)", row["callsign"].strip().upper())
    commercial = normalize_number(row.get("number", ""))
    if commercial and commercial != number:
        return False
    return bool(call and call[1] in carrier[1] and int(call[2]) == number[1]
                and (not call[3] or commercial == number))


def observation(row, file_url):
    return {"source": "OpenSky", "sourceURL": SOURCE, "dataURL": file_url,
            "callsign": row["callsign"].strip(), "icao24": row["icao24"],
            "tailNumber": row.get("registration") or None, "aircraftType": row.get("typecode") or None,
            "firstSeenUTC": instant(row["firstseen"]).astimezone(timezone.utc).isoformat(),
            "lastSeenUTC": instant(row["lastseen"]).astimezone(timezone.utc).isoformat()}


def verified_download(entry, path):
    algorithm, checksum = entry["checksum"].split(":")
    def valid(p):
        if not p.exists() or p.stat().st_size != entry["size"]:
            return False
        h = hashlib.new(algorithm)
        with p.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest() == checksum
    if not valid(path):
        staged = path.with_suffix(".part")
        with urllib.request.urlopen(entry["links"]["self"], timeout=120) as response, staged.open("wb") as out:
            shutil.copyfileobj(response, out)
        if not valid(staged):
            raise ValueError(f"Checksum mismatch: {path.name}")
        staged.replace(path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("csv", type=Path)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    flights = list(csv.DictReader(args.csv.open(newline="", encoding="utf-8-sig")))
    metadata = json.load(urllib.request.urlopen(RECORD, timeout=60))
    (args.cache / "record.json").write_text(json.dumps(metadata, indent=2))
    entries = {f["key"][11:17]: f for f in metadata["files"] if f["key"].startswith("flightlist_")}
    license_file = next(f for f in metadata["files"] if f["key"] == "LICENSE.txt")
    verified_download(license_file, args.cache / "LICENSE.txt")
    groups = defaultdict(list)
    report = {}
    for f in flights:
        month = f["date"][:7].replace("-", "")
        if month not in entries:
            report[key_for(f)] = {"status": "outside-coverage"}
        elif any(f[k] not in AIRPORTS for k in ("from", "to")):
            report[key_for(f)] = {"status": "unsupported-airport"}
        else:
            groups[month].append(f)

    def process(month):
        entry = entries[month]
        path = args.cache / entry["key"]
        print(f"{month}: fetching/verifying {entry['size'] // 1000000} MB", flush=True)
        verified_download(entry, path)
        by_route = defaultdict(list)
        candidates = {key_for(f): [] for f in groups[month]}
        exact = defaultdict(list)
        for f in groups[month]:
            by_route[(AIRPORTS[f["from"]][0], AIRPORTS[f["to"]][0])].append(f)
        with gzip.open(path, "rt", newline="") as stream:
            for row in csv.DictReader(stream):
                for f in by_route.get((row["origin"], row["destination"]), []):
                    day = instant(row["firstseen"]).astimezone(ZoneInfo(AIRPORTS[f["from"]][1])).date().isoformat()
                    if day != f["date"]:
                        continue
                    carrier = CARRIERS.get(f["airline"])
                    if carrier and not row["callsign"].startswith(carrier[1]):
                        continue
                    obs = observation(row, entry["links"]["self"])
                    candidates[key_for(f)].append(obs)
                    if exact_identity(f, row):
                        exact[key_for(f)].append(obs)
        result = {}
        for f in groups[month]:
            key = key_for(f)
            # Never collapse duplicate observations and silently choose an aircraft.
            matches = exact[key]
            result[key] = {"status": "matched-observation" if len(matches) == 1 else "ambiguous" if matches else "unconfirmed" if candidates[key] else "no-match",
                           "observation": matches[0] if len(matches) == 1 else None,
                           "candidates": candidates[key]}
        print(f"{month}: {sum(r['observation'] is not None for r in result.values())} exact observations", flush=True)
        return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(process, sorted(groups)):
            report.update(result)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            staged = args.output.with_suffix(".tmp")
            staged.write_text(json.dumps({"version": 1, "retrievedAt": datetime.now(timezone.utc).isoformat(),
                "sourceURL": SOURCE, "report": report}, indent=2) + "\n")
            staged.replace(args.output)
    print(f"Matched {sum(bool(r.get('observation')) for r in report.values())} tracking observations")


if __name__ == "__main__":
    main()
