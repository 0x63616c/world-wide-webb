# Sonos Groups Modal — Design

Date: 2026-07-11
Status: approved (mock iterated live with Calum; final = patch-bay layout, D1 cards)
Mock: claude.ai artifact `sonos-groups-mock` (patch bay, D1 cards, staggered EQ)

## Problem

The panel can control per-room volume/mute and sources, but not Sonos **grouping**:
"play what's on Desk everywhere", "TV in the living room, desk audio in the other
four rooms". Backend write paths exist (`sonosGroupJoin`/`sonosGroupLeave` +
tRPC mutations) but no UI uses them — `MixerModal` accepts `onGroupJoin`/
`onGroupLeave` props and renders nothing for them.

## UX (approved)

New **Groups modal**, opened from a third launcher on the Sound System tile
(alongside Mixer and Sources). Patch-bay layout:

- **Left column — Sources.** One card per source. Card: room-name + source
  label ("Desk · Line-In", "Living Room · TV", "Bedroom · Spotify"), track line
  when real metadata exists, SESSION badge on dynamic cards, animated EQ bars
  (right edge) while playing — staggered deterministically per card (uuid hash →
  phase/duration offsets), never the word "PLAYING". Selecting a card shows a
  colored jack dot and arms the speaker column. An **ALL** button appears on the
  selected card only.
- **Right column — Speakers.** One row per visible room, LED dot tinted the
  color of the source the room currently follows, current source name right-
  aligned ("off" when idle). Tap = patch to the selected source; tap a row
  already on the selected source = drop to off. The selected source's anchor row
  is disabled (see Anchor rule).

### Source model

- **Hardware sources (floor of 2, always rendered, even silent):**
  - Desk · Line-In — anchor: Desk player, URI `x-rincon-stream:<DESK_UUID>:0`.
  - Living Room · TV — anchor: Beam, URI `x-sonos-htastream:<BEAM_UUID>:spdif`.
- **Session sources (dynamic):** any group coordinator playing its own stream
  whose URI is not one of the two hardware URIs (Spotify/AirPlay/etc). Appear
  while live, disappear on stop.
- Source identity keys on the coordinator uuid + URI class, `src_`-prefixed ids.

### Deterministic ordering & color

- Sources: Desk, TV, then sessions ordered by the existing `ROOM_ORDER` rank of
  their coordinator room (ties: alphabetical).
- Speakers: `ROOM_ORDER` (existing service ordering).
- Colors: Desk = `--acc` blue, TV = `--amber`, sessions take from a fixed hue
  list starting `--teal` (assignment by source order, stable within a session's
  lifetime).

### Interaction semantics

- Tap speaker (selected source S): fires `media.sonosGroupJoin({memberIp,
  coordinatorUuid: S.anchorUuid})` — immediate apply, optimistic UI.
- Tap speaker already on S: `media.sonosGroupLeave({memberIp, memberUuid})`.
- ALL on S: joins every speaker except anchors of other sources. An anchor can
  only be stolen by explicitly selecting its source and patching it elsewhere;
  ALL never silently kills another source.
- TV special case: patching to TV when the Beam is not already on its
  `htastream` URI first fires `sonosGrabTvToBeam`, then joins members.
- **Anchor rule:** a source's anchor speaker cannot be removed from its own
  source (mute/volume cover "quiet anchor"; avoids coordinator hand-off
  complexity). Design choice, not hardware constraint — revisit if needed.

### Freshness / reconcile

- Modal reads a new `media.soundSystem`-style query (extended, below) on the
  same 10s poll + `invalidate()` after every join/leave mutation.
- Group membership uses the desired-vs-reported pattern from branch
  `worktree-mixer-stale-poll-reconcile`: a polled snapshot only overwrites local
  membership state when `dataUpdatedAt > lastGroupEditAt` (per speaker). This
  feature builds against that branch's two-arg `useMixer(rooms, dataUpdatedAt)`
  signature; coordinate landing order.

## Backend changes

1. **Bugfix (ship first, standalone):** `SonosClient.getPositionInfo`
   (`client.ts:129`) parses `TrackMetaData` without `decodeXmlEntities`, so
   entity-encoded DIDL (real firmware behavior, verified live) yields null
   title/artist/art for all streaming sources. Apply the same decode used by
   `getZoneGroupState`.
2. **`SonosClient.getMediaInfo()`** — new method returning `CurrentURI` (+
   decoded URI metadata title). Needed to classify each group's source.
3. **Extend the sound-system service/query** with per-group source info:
   `{ kind: "line-in" | "tv" | "spotify" | "airplay" | "other" | "idle",
   trackTitle, trackArtist, albumArtUri }` derived from coordinator
   `GetMediaInfo` URI scheme + `GetPositionInfo` metadata. No fake data: absent
   metadata renders as input-kind label only.
4. Hardware-source constants (Desk uuid, Beam uuid + IPs) live next to
   `TOPOLOGY_ANCHOR_IP`/`DESK_RF_BONDED_UUID` in the sound-system service.

## Frontend changes

- `GroupsModal` (presentational, Storybook-first) + `GroupsModalContainer`
  wiring tRPC — same split as SoundSystemTile/View. Shared `ui` primitives
  (Modal). Fixed panel, not responsive.
- Source derivation is a pure function `deriveSources(groups, sourceInfo)` —
  unit-tested: floor cards, session detection, dedup against hardware URIs,
  ordering, color assignment.
- Membership reducer with `lastGroupEditAt` gating — unit-tested against stale
  snapshot replay.
- Sound System tile header gains the Groups launcher (no tile-registry change —
  modal, not tile).

## Out of scope (v2+)

- Apple TV AirPlay output control (needs a pyatv sidecar; HA cannot do it —
  verified live: `media_player.living_room_tv` exposes app/state only).
- HomePod as a group target.
- Unjoinable anchor / coordinator hand-off.

## Testing

- Unit: source derivation, membership reducer, URI classification, DIDL decode.
- API: `getMediaInfo` SOAP parse fixtures (encoded + CDATA variants).
- Storybook stories: 2-source floor (silent), 2 live, 3 with session, mid-patch.
- Manual verify on real system (5 rooms live on LAN).
