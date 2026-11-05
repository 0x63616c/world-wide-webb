# Spotify through Home Assistant

API-only feature for the native Spotify app. No Spotify credentials are stored
in the panel. The existing server-side Home Assistant client owns authentication.

`spotify.state` discovers Spotify accounts (standard entity ID or Spotify icon)
and Sonos rooms (`group_members`) from Home Assistant. `spotify.browse` uses
Home Assistant's `media_player.browse_media` response action; browse navigation
is scoped to those discovered sources. `spotify.play` accepts Spotify share
links/URIs or Sonos favourite IDs. Commands target the selected room's current
group coordinator, preserving existing grouping. Transport controls use the
same Home Assistant media-player services as the Sound System feature.

Connect Spotify in Home Assistant to browse its library. For Sonos playback,
Spotify must also be linked in the Sonos app. Links work without a separate
Spotify developer integration when Sonos is already connected. This is remote
speaker control; it does not stream Spotify audio on the panel itself.

The native UI keeps errors retryable and never substitutes a sample library.
The source must support Home Assistant's browse response action. Unsupported
or disconnected libraries show an explanation while retaining link playback.
No global Spotify search or separate OAuth/token database is introduced.

Sources checked 5 November 2026:
- [Spotify integration](https://www.home-assistant.io/integrations/spotify/)
- [Sonos integration](https://www.home-assistant.io/integrations/sonos/)
- [Browse media action](https://www.home-assistant.io/actions/media_player.browse_media/)
- [REST response actions](https://developers.home-assistant.io/docs/api/rest/)

Read-only production verification on 5 November 2026 found five available Sonos
rooms, no Spotify HA account, and a working browse response action. Sonos
favourites start at the empty-ID `favorites` root; unrelated HA media sources
are not presented as a Spotify library. Live playback has not been exercised.
Simulator/unit fixtures test routing and failures without playing music in the home.
