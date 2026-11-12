#!/usr/bin/env python3
"""Fail a release if its Developer ID profile cannot authorize our iCloud app."""

import datetime
import hashlib
import plistlib
import sys

with open(sys.argv[1], "rb") as stream:
    profile = plistlib.load(stream)
with open(sys.argv[2], "rb") as stream:
    requested = plistlib.load(stream)
allowed = profile["Entitlements"]
assert profile.get("ProvisionsAllDevices") is True, "Expected a Developer ID distribution profile"
assert not allowed.get("get-task-allow", False), "Development profiles cannot ship"
assert profile["ExpirationDate"] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), (
    "Provisioning profile expired"
)
assert any(
    hashlib.sha1(cert).hexdigest().upper() == "6B72BD268029806DDE048472F139EAB5CEFCA37D"
    for cert in profile["DeveloperCertificates"]
), "Profile does not include the release signing certificate"
for key in [
    "com.apple.application-identifier",
    "com.apple.developer.team-identifier",
    "com.apple.developer.icloud-container-environment",
]:
    assert allowed.get(key) == requested[key], f"Profile does not authorize {key}"
for key in [
    "com.apple.developer.icloud-container-identifiers",
    "com.apple.developer.ubiquity-container-identifiers",
    "com.apple.developer.icloud-services",
]:
    permitted = allowed.get(key, [])
    assert permitted == "*" or all(value in permitted for value in requested[key]), f"Profile does not authorize {key}"
print("Developer ID profile authorizes Callkeep’s production iCloud document container.")
