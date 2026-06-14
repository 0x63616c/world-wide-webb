# Media tiles , verified integration notes (www-c2pc)

These are the **live-tested** facts from the Sonos/Apple TV exploration session (bd epic
`www-c2pc`, discovery comments). Everything below was exercised against real hardware on
`homelab`. Build the tiles in `IMPLEMENTATION_HANDOFF.md` against these , **no invented
capabilities, no fake/DEMO data**. Services THROW on error/unconfigured (repo convention).

## Two backbones

1. **Home Assistant** (preferred backbone, already wired in the repo:
   `products/control-center/api/src/integrations/homeassistant/`). Env: `HA_URL`
   (default `http://homeassistant.local:8123`, prod `host.docker.internal:8123`),
   `HA_TOKEN` (1Password `op://Homelab/Home Assistant Token/credential`, delivered as a
   docker secret). HA unifies Sonos + Apple TV + HomePod + Spotify as `media_player`
   entities, and is the **only** path that sees Apple TV now-playing / scrub / app-launch.
   - Read: `GET /api/states` (all) · `GET /api/states/<entity_id>` (one).
   - Write: `POST /api/services/<domain>/<service>` body `{"entity_id":"...", ...}`.
   - Browse media (apps list): WebSocket only , `ws://homelab:8123/api/websocket`.
2. **Raw Sonos UPnP/SOAP** on port **1400** (no cloud, no auth) for Sonos-only power moves
   HA can't do: whole-house grouping, line-in routing, send-TV-audio-to-Beam, favorites, EQ.

## HA media_player entities (the unified surface)

| Entity | Device |
|---|---|
| `media_player.living_room_tv` (+ `remote.living_room_tv`) | **Apple TV** |
| `media_player.homepod` | HomePod (idle in testing; control not exercised) |
| `media_player.living_room` | Sonos **Living Room** (Beam) |
| `media_player.desk` | Sonos **Desk** (Era 300 stereo pair) |
| `media_player.bedroom` | Sonos **Bedroom** (Era 300) |
| `media_player.bathroom` | Sonos **Bathroom** (Era 100) |
| `media_player.kitchen` | Sonos **Kitchen** (Era 100 SL) |
| `media_player.evee_media_player` | Spotify Connect target (`source: Spotify`) |

## Sonos devices (SSDP discovery on :1400, network 192.168.0.0/24)

Collapse the invisible bonded Desk RF (.161) into its coordinator → **show 5 rooms**.

| Room | Hardware | IP | UUID |
|---|---|---|---|
| Living Room | Beam (S31) | .193 | `RINCON_74CA6093255801400` |
| Desk | 2× Era 300 pair | .152 (coord) / .161 (bonded) | `RINCON_804AF28AAB2001400` / `RINCON_804AF288FDBA01400` |
| Bedroom | Era 300 | .63 | `RINCON_804AF28CFD6801400` |
| Bathroom | Era 100 | .149 | `RINCON_F85C2420570401400` |
| Kitchen | Era 100 SL | .179 | `RINCON_74CA60AA5F4C01400` |

### Sonos SOAP (all verified working)
POST `http://<ip>:1400<controlPath>`, headers `Content-Type: text/xml; charset="utf-8"`,
`SOAPACTION: "<serviceType>#<action>"`, body = SOAP envelope.

- **RenderingControl** `/MediaRenderer/RenderingControl/Control` , `GetVolume`/`SetVolume`
  `{InstanceID:0, Channel:'Master', DesiredVolume:0-100}` (per-device); `GetMute`/`SetMute`.
- **AVTransport** `/MediaRenderer/AVTransport/Control` ,
  `GetTransportInfo` → `PLAYING|PAUSED_PLAYBACK|STOPPED`; `Play{Speed:1}`/`Pause{Speed:1}`/`Stop`/`Next`/`Previous`;
  `GetPositionInfo` → `TrackMetaData` (DIDL `dc:title`, `dc:creator`, art), `TrackDuration`, `RelTime`.
  Transport + now-playing belong to the **group coordinator**; volume/mute are per-device.
- **Group / ungroup**: on a member, `SetAVTransportURI{CurrentURI:'x-rincon:<COORDINATOR_UUID>', CurrentURIMetaData:''}` then `Play`.
- **Line-in source** (Desk): `SetAVTransportURI{CurrentURI:'x-rincon-stream:RINCON_804AF28AAB2001400:0'}` then `Play`.
- **TV audio → Beam**: `SetAVTransportURI{CurrentURI:'x-sonos-htastream:RINCON_74CA6093255801400:spdif'}` then `Play`.
- **Topology** `ZoneGroupTopology` `/ZoneGroupTopology/Control` , `GetZoneGroupState` → coordinators + members. **Read fresh every poll , grouping is volatile** (TV power reshapes it live).
- **Favorites** `ContentDirectory` `Browse{ObjectID:'FV:2', BrowseFlag:'BrowseDirectChildren', Filter:'*', RequestedCount:50}` → currently 1 ("Riordan Radio").

### Sonos gotchas
- **Line-in and TV expose NO metadata** (title/artist/duration all `NOT_IMPLEMENTED`) → label tile by source ("LINE-IN · Desk", "TV"). Only streaming sources carry track info.
- Grouping is volatile , always read topology fresh, never cache.
- Can't start arbitrary Spotify/Apple Music tracks via SOAP (needs each service's auth) , favorites / queue / line-in / TV / grouping all work locally.

## Apple TV (HA only , raw Sonos cannot see it)

`media_player.living_room_tv` + `remote.living_room_tv`. `supported_features` 450487 decoded:
**supported** = PAUSE, SEEK, VOLUME_SET, PREV, NEXT, TURN_ON/OFF, PLAY_MEDIA, VOLUME_STEP,
SELECT_SOURCE, STOP, PLAY, SHUFFLE_SET, BROWSE_MEDIA, REPEAT_SET. **NOT** = VOLUME_MUTE,
GROUPING.

- Now-playing read: `app_name`, `app_id`, `media_title`, `media_artist`, `media_duration`,
  `media_position`, `media_position_updated_at` (caught a live YouTube video 12:35/27:23).
- **Seek** (verified): `POST /api/services/media_player/media_seek`
  `{"entity_id":"media_player.living_room_tv","seek_position":<seconds>}`.
- **Pause/play/next/prev/volume_set/turn_on/turn_off**: same `media_player` domain (verified pause).
- **Apps (27)**: `source_list` on the entity; launch via `media_player/select_source` (source
  name) or `play_media` (bundle id). Bundle ids seen: `com.google.ios.youtube`,
  `com.netflix.Netflix`, `com.disney.disneyplus`, `com.amazon.aiv.AIVApp` (Prime),
  `com.hulu.plus`, `com.hbo.hbonow`, `com.spotify.client`. Full list via WS `media_player/browse_media`.
- **D-pad**: `remote.send_command` , `up/down/left/right/select`, `menu` (back), `home`,
  `home_hold` (app switcher), `play_pause`, `play`, `pause`, `stop`, `next`, `previous`,
  `skip_forward`, `skip_backward`, `suspend`, `wakeup`. (Mapped, not fired in testing.)

### Apple TV gotchas
- **No mute** (volume routes through Sonos/HomePod , say so in UI, no mute control).
- No audio-output attribute , infer routing from receiving side (HomePod/Beam idle while AppleTV position advances ⇒ TV speakers).
- `source` is empty when an app is open , rely on `app_name`/`app_id`.

## Spotify

Only verified path = HA entity `media_player.evee_media_player` (Spotify Connect target) plus
the one Sonos Favorite ("Riordan Radio", a Spotify artist-radio station, playable via Sonos
SOAP without auth). **No Spotify Web API / OAuth is provisioned.** Quick-Play presets should
source from **Sonos Favorites + the HA Spotify entity**, not a new Spotify Web API integration,
unless credentials are added later (1Password rail like HA_TOKEN).

## Done vs missing (as of www-c2pc discovery)

- **Verified working**: full Sonos discovery/topology/control, Apple TV now-playing + seek +
  pause + app list via HA, HA backbone reachable + authed.
- **Not yet built**: zero code in repo , no `media_player` references in `products/control-center/api/src` or
  `products/control-center/web/src`. No tRPC media router, no Sonos SOAP helper, no tiles, no stories.
- **Light-tested**: HomePod (idle read only), Apple TV app-launch + D-pad (mapped, not fired).
