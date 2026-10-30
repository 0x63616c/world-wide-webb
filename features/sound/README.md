# Native Sonos API

The existing `sound.soundSystem` response and writes remain unchanged. WWW-42
(PR #811) already added optional `position`, `duration` (seconds), `positionAt`
(HA sample time, ISO UTC), and `sound.sonosSeek({ room, positionSeconds })`.
Clients must require a complete sample before presenting a scrubber and target
the coordinator for group playback. Missing values are not zero readings.

WWW-30 adds `GET /media/sonos/<media_player.entity_id>/artwork`. It streams the
current cover through Home Assistant's authenticated `media_player_proxy` using
the existing server configuration. Clients send only the room's coordinator ID;
HA URLs and credentials stay server-side. The route accepts JPEG, PNG and WebP,
returns `private, no-store`, and strips upstream headers. Missing/unavailable
artwork returns an error, never a placeholder image. Existing `albumArtUri` is
retained for backward compatibility. The native module does not fetch that URL.

Test with `bun run --cwd apps/api test`; run `bun run typecheck` and
`bun run apps:check` from the repository root. Fixtures and stub bytes are
synthetic; tests never contact Home Assistant.
