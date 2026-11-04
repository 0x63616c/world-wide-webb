#!/usr/bin/env python3
"""Install a local air-miles CSV into an already installed simulator app.

Usage: python3 apps/airmiles/scripts/import-simulator.py path/to/segments.csv DEVICE_UDID
Never commit private input. The app validates the CSV on launch.
"""
import csv
import io
from pathlib import Path
import subprocess
import sys

source, device = sys.argv[1:]
fields = ["date", "airline", "flight", "from", "to", "miles", "confidence"]
with Path(source).open(newline="", encoding="utf-8-sig") as stream:
    reader = csv.DictReader(stream)
    if not set(fields).issubset(reader.fieldnames or []):
        raise SystemExit("Input is missing required columns")
    rows = [{key: row[key] for key in fields} for row in reader]
if not rows:
    raise SystemExit("Input has no flights")
container = subprocess.check_output([
    "xcrun", "simctl", "get_app_container", device, "com.calumwebb.airmiles", "data"
], text=True).strip()
destination = Path(container) / "Documents" / "segments.csv"
destination.parent.mkdir(parents=True, exist_ok=True)
if destination.exists():
    backup = destination.with_suffix(".previous.csv")
    backup.write_bytes(destination.read_bytes())
buffer = io.StringIO()
writer = csv.DictWriter(buffer, fieldnames=fields)
writer.writeheader()
writer.writerows(rows)
staged = destination.with_suffix(".tmp")
staged.write_text(buffer.getvalue(), encoding="utf-8")
staged.replace(destination)
print(f"Imported {len(rows)} records locally; mailbox IDs removed.")
