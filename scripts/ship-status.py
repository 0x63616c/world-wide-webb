#!/usr/bin/env python3
# Renders the P0/P1 ticket roll-up for ship-status.sh. Reads `bd list --json` on stdin.
import sys, json

try:
    d = json.load(sys.stdin)
except Exception:
    print(" (bd unavailable)")
    sys.exit(0)

p = [i for i in d if i.get("priority") in (0, 1)]
if not p:
    print(" (no P0/P1 issues)")
    sys.exit(0)

closed = [i for i in p if i.get("status") == "closed"]
inprog = [i for i in p if i.get("status") == "in_progress"]
openi = [i for i in p if i.get("status") not in ("closed",)]
print(f" P0/P1: {len(closed)}/{len(p)} closed · {len(inprog)} in-progress · {len(openi)} open")
print()
MARK = {"closed": "\033[32m✔\033[0m", "in_progress": "\033[33m●\033[0m",
        "open": "○", "blocked": "\033[31m✖\033[0m"}
for i in sorted(p, key=lambda x: (x.get("status") != "in_progress", x.get("priority", 9), x.get("id"))):
    mark = MARK.get(i.get("status"), "·")
    print(f"  {mark} P{i.get('priority')} {i['id']:8} {i.get('title','')[:46]}")
