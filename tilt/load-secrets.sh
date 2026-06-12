#!/usr/bin/env bash
# Reads each dev secret via `op read` (shim-cached, no rate-limit risk).
# Replaces `op inject` in the Tiltfile. Output: KEY=VALUE lines.
set -euo pipefail

printf 'HA_TOKEN=%s\n'           "$(op read 'op://Homelab/Home Assistant Token/credential')"
printf 'UNIFI_API_KEY=%s\n'      "$(op read 'op://Homelab/UniFi/local_api_key')"
printf 'WIFI_SSID=%s\n'          "$(op read 'op://Homelab/WiFi Guest Credentials/ssid')"
printf 'WIFI_PASSWORD=%s\n'      "$(op read 'op://Homelab/WiFi Guest Credentials/password')"
printf 'HOME_LAT=%s\n'           "$(op read 'op://Homelab/Home Location/lat')"
printf 'HOME_LON=%s\n'           "$(op read 'op://Homelab/Home Location/lon')"
printf 'HOME_PLACE_NAME=%s\n'    "$(op read 'op://Homelab/Home Location/place_name')"
printf 'HOME_RADIUS_MILES=%s\n'  "$(op read 'op://Homelab/Home Location/radius_miles')"
