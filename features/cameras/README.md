# Cameras (WWW-34)

Source: Home Assistant's `camera.*` entities, using the existing server-only
`HA_URL` / `HA_TOKEN` configuration and shared HA client. No new credentials,
camera addresses, database tables, workers, or web tiles are needed.

- `cameras.list` returns `[{ id, name, state }]`. Names use `friendly_name` or
  the entity ID; no attributes, camera tokens or `entity_picture` URLs escape.
  An empty list means no cameras; HA failure becomes `SERVICE_UNAVAILABLE`.
- `GET /media/cameras/:id/snapshot` proxies HA's
  `/api/camera_proxy/<entity_id>` with the server bearer token. Only validated
  camera IDs are accepted, never URLs/query strings. JPEG/PNG/WebP bytes stream
  through with `private, no-store` and `nosniff`; upstream headers/error bodies
  are discarded. Missing camera: 404; invalid image: 502; HA failure: 503.

The existing `/media/` nginx route and Cloudflare Access application for
`app.worldwidewebb.co` cover this endpoint. Like existing tRPC/media endpoints,
it trusts the Access perimeter; do not expose the API service directly. Native
requests carry the existing Access header pair, never HA credentials.

Live view uses repeated snapshots (3 seconds in the overview; 1 second for the
selected enlarged feed). There is deliberately no MJPEG/HLS/WebRTC session or
audio. The client cancels requests on navigation/background and retains frames
only in memory. Camera integrations may return cached images; actual cadence
depends on HA and the camera. No physical-camera verification is claimed here.

This is additive: old clients and all existing procedures/routes are unchanged.
The native app treats missing endpoints, no cameras and service failures as
unavailable and keeps the web fallback. Either deployment order is supported.

HA endpoint reference:
https://contributors.home-assistant.io/core/internals/rest-api/#other-integrations
