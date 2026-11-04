#!/usr/bin/env python3
"""Match a private journal locally against public BTS monthly marketing-carrier data.

No flight history is uploaded. Archives, output and reports belong in ignored build/.
Requires Python 3.9+, no third-party packages. Unknown/ambiguous identities are skipped.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import shutil
import urllib.parse
import urllib.request
import zipfile

BASE = "https://transtats.bts.gov/PREZIP/"
CARRIERS = {"Delta": "DL", "United": "UA", "American": "AA", "Alaska": "AS",
            "Frontier": "F9", "JetBlue": "B6", "Southwest": "WN"}


def identity(flight):
    carrier = CARRIERS.get(flight["airline"])
    match = re.fullmatch(r"([A-Z0-9]{2})\s*0*(\d+)", flight["flight"].strip().upper())
    if not carrier or not match or match[1] != carrier:
        return None
    return (flight["date"], carrier, str(int(match[2])), flight["from"], flight["to"])


def key_for(flight):
    # Mirrors Flight.enrichmentKey. Keep the original airline/number in the key.
    return "|".join(flight[k] for k in ("date", "airline", "flight", "from", "to"))


def integer(value):
    return int(float(value)) if value.strip() else None


def clock(value):
    if not value.strip():
        return None
    hour, minute = divmod(int(value), 100)
    if (0 <= hour < 24 and 0 <= minute < 60) or (hour == 24 and minute == 0):
        return f"{hour:02}:{minute:02}"
    raise ValueError(f"Invalid BTS local time: {value}")


def operation(row, source):
    result = {"sourceURL": source, "source": "BTS", "cancelled": integer(row["Cancelled"]) == 1,
              "diverted": integer(row["Diverted"]) == 1,
              "operatingCarrier": row["IATA_Code_Operating_Airline"],
              "operatingFlightNumber": row["Flight_Number_Operating_Airline"],
              "tailNumber": row["Tail_Number"].strip() or None}
    for name, field in {"scheduledDeparture": "CRSDepTime", "actualDeparture": "DepTime",
                        "scheduledArrival": "CRSArrTime", "actualArrival": "ArrTime"}.items():
        result[name] = clock(row[field])
    for name, field in {"departureDelay": "DepDelay", "arrivalDelay": "ArrDelay",
                        "elapsedMinutes": "ActualElapsedTime", "airborneMinutes": "AirTime"}.items():
        result[name] = integer(row[field])
    # A diverted arrival clock can describe another airport; never imply arrival at the booked destination.
    if result["cancelled"] or result["diverted"]:
        for field in ("actualArrival", "arrivalDelay", "elapsedMinutes", "airborneMinutes"):
            result[field] = None
    return result


def match_archive(path, wanted, source):
    matches = defaultdict(list)
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        if len(names) != 1:
            raise ValueError("Expected one monthly BTS CSV")
        with archive.open(names[0]) as raw:
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")):
                key = (row["FlightDate"], row["IATA_Code_Marketing_Airline"],
                       str(int(row["Flight_Number_Marketing_Airline"])), row["Origin"], row["Dest"])
                if key in wanted:
                    matches[key].append(operation(row, source))
    # Duplicate reports are ambiguous even when their fields happen to agree.
    return {key: rows[0] for key, rows in matches.items() if len(rows) == 1}, set(k for k, v in matches.items() if len(v) > 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with args.csv.open(newline="", encoding="utf-8-sig") as stream:
        flights = list(csv.DictReader(stream))
    airport_file = Path(__file__).resolve().parents[1] / "App/Resources/airports.json"
    airports = {a["code"]: a for a in json.loads(airport_file.read_text())}
    with urllib.request.urlopen(BASE, timeout=60) as response:
        directory = response.read().decode()
    available = {}
    for link in re.findall(r'href="([^"]+)"', directory, re.I):
        match = re.search(r"On_Time_Marketing_Carrier_On_Time_Performance_Beginning_January_2018_(\d{4})_(\d+)\.zip", link)
        if match:
            available[f"{match[1]}-{int(match[2]):02}"] = urllib.parse.urljoin(BASE, link)
    if not available:
        raise RuntimeError("BTS archive index is unavailable; existing enrichment was not changed")
    groups, report = defaultdict(list), []
    for flight in flights:
        domestic = all(airports.get(flight[k], {}).get("country") == "US" for k in ("from", "to"))
        month = flight["date"][:7]
        reason = "outside-coverage" if not domestic else "uncertain-identity" if not identity(flight) else "month-unavailable" if month not in available else None
        if reason:
            report.append({"key": key_for(flight), "status": reason})
        else:
            groups[month].append(flight)

    def process(month):
        source = available[month]
        path = args.cache / f"{month}.zip"
        if not path.exists() or not zipfile.is_zipfile(path):
            staged = path.with_suffix(".part")
            with urllib.request.urlopen(source, timeout=120) as response, staged.open("wb") as output:
                shutil.copyfileobj(response, output)
            if not zipfile.is_zipfile(staged):
                raise ValueError(f"Invalid BTS archive for {month}")
            staged.replace(path)
        matched, ambiguous = match_archive(path, {identity(f) for f in groups[month]}, source)
        print(f"{month}: {len(matched)} exact matches", flush=True)
        return month, matched, ambiguous

    records = {}
    # Two concurrent public downloads; no personal data is sent in any request.
    with ThreadPoolExecutor(max_workers=2) as pool:
        for month, matched, ambiguous in pool.map(process, sorted(groups)):
            for flight in groups[month]:
                key = identity(flight)
                if key in matched:
                    records[key_for(flight)] = matched[key]
                report.append({"key": key_for(flight), "status": "matched" if key in matched else "ambiguous" if key in ambiguous else "no-match"})
    document = {"version": 1, "retrievedAt": datetime.now(timezone.utc).isoformat(),
                "latestMonth": max(available), "records": records}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    staged = args.output.with_suffix(".tmp")
    staged.write_text(json.dumps(document, indent=2) + "\n")
    staged.replace(args.output)
    args.output.with_suffix(".report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Enriched {len(records)} of {len(flights)} journal records. Latest BTS month: {max(available)}")


if __name__ == "__main__":
    main()
