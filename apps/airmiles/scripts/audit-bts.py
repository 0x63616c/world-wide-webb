#!/usr/bin/env python3
"""Find review candidates without changing any journal identity or enrichment.

Uses the exact match report from enrich-bts.py. Even a single route/date candidate
remains unconfirmed: a timetable alone does not establish the passenger's flight.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import urllib.request
import zipfile
import sys
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("bts", Path(__file__).with_name("enrich-bts.py"))
bts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bts)


def relationship(flight, row):
    if row["FlightDate"] != flight["date"]:
        return None
    carrier = bts.CARRIERS.get(flight["airline"])
    if carrier and row["IATA_Code_Marketing_Airline"] != carrier:
        return None
    if (row["Origin"], row["Dest"]) == (flight["from"], flight["to"]):
        return "same-date-route"
    known = bts.identity(flight)
    if known and row["Flight_Number_Marketing_Airline"].lstrip("0") == known[2]:
        return "same-number-different-route"
    return None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("csv", type=Path)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    flights = list(csv.DictReader(args.csv.open(newline="", encoding="utf-8-sig")))
    unresolved = {r["key"] for r in json.loads(args.report.read_text())
                  if r["status"] in ("uncertain-identity", "no-match", "ambiguous")}
    groups = defaultdict(list)
    for f in flights:
        if bts.key_for(f) in unresolved:
            groups[f["date"][:7]].append(f)
    with urllib.request.urlopen(bts.BASE, timeout=60) as response:
        directory = response.read().decode()
    available = {}
    for link in re.findall(r'href="([^"]+)"', directory, re.I):
        match = re.search(r"On_Time_Marketing_Carrier_On_Time_Performance_Beginning_January_2018_(\d{4})_(\d+)\.zip", link)
        if match:
            available[f"{match[1]}-{int(match[2]):02}"] = bts.urllib.parse.urljoin(bts.BASE, link)
    args.cache.mkdir(parents=True, exist_ok=True)

    def process(month):
        source = available[month]
        path = args.cache / f"{month}.zip"
        if not path.exists() or not zipfile.is_zipfile(path):
            staged = path.with_suffix(".part")
            with urllib.request.urlopen(source, timeout=120) as response, staged.open("wb") as out:
                shutil.copyfileobj(response, out)
            if not zipfile.is_zipfile(staged):
                raise ValueError(f"Invalid archive: {month}")
            staged.replace(path)
        by_date = defaultdict(list)
        results = {bts.key_for(f): [] for f in groups[month]}
        for flight in groups[month]:
            by_date[flight["date"]].append(flight)
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if len(names) != 1:
                raise ValueError("Expected one monthly CSV")
            with archive.open(names[0]) as raw:
                for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")):
                    for flight in by_date.get(row["FlightDate"], []):
                        reason = relationship(flight, row)
                        if reason:
                            results[bts.key_for(flight)].append({
                                "reason": reason, "confirmed": False,
                                "date": row["FlightDate"], "from": row["Origin"], "to": row["Dest"],
                                "flight": row["IATA_Code_Marketing_Airline"] + row["Flight_Number_Marketing_Airline"],
                                "operation": bts.operation(row, source)})
        print(f"{month}: audited {len(results)} unresolved identities", flush=True)
        return results

    candidates = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(process, sorted(m for m in groups if m in available)):
            candidates.update(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"version": 1, "candidates": candidates}, indent=2) + "\n")
    print(f"Saved candidates for {len(candidates)} flights; none automatically confirmed.")


if __name__ == "__main__":
    main()
