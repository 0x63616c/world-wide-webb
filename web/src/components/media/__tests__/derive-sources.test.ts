/**
 * Tests for deriveSources / membershipByUuid (Groups modal source derivation, www-51hf).
 *
 * Pure derivation from SoundSystemRoom[] (as delivered by trpc.media.soundSystem)
 * into the GroupSource list the Groups modal renders: two always-present hardware
 * floor cards (Desk · Line-In, Living Room · TV) plus dynamic session cards for any
 * other group actually playing something. Fixtures use the real house topology
 * verified live 2026-07-11.
 */
import { describe, expect, it } from "vitest";
import {
  deriveSources,
  type GroupSource,
  membershipByUuid,
  SESSION_HUES,
} from "../lib/derive-sources";
import { BEAM_UUID, DESK_LINE_IN_UUID } from "../lib/sonos-constants";

type SourceKind = "line-in" | "tv" | "spotify" | "airplay" | "other" | "idle";

interface RoomFixture {
  name: string;
  uuid: string;
  deviceIp: string;
  coordinatorUuid: string;
  memberUuids: string[];
  isCoordinator: boolean;
  volume: number;
  muted: boolean;
  transportState: string;
  sourceLabel: string | null;
  sourceKind: SourceKind;
  trackTitle: string | null;
  trackArtist: string | null;
  albumArtUri: string | null;
}

// Real house topology, verified live 2026-07-11.
const DESK_UUID = DESK_LINE_IN_UUID; // "RINCON_804AF28AAB2001400"
const DESK_IP = "192.168.0.152";
const LR_UUID = BEAM_UUID; // "RINCON_74CA6093255801400"
const LR_IP = "192.168.0.193";
const BEDROOM_UUID = "RINCON_804AF28CFD6801400";
const BEDROOM_IP = "192.168.0.63";
const KITCHEN_UUID = "RINCON_74CA60AA5F4C01400";
const KITCHEN_IP = "192.168.0.179";
const BATHROOM_UUID = "RINCON_F85C2420570401400";
const BATHROOM_IP = "192.168.0.149";

/** Fills defaults for every SoundSystemRoom field; an idle, self-coordinated room. */
function room(
  partial: Partial<RoomFixture> & { name: string; uuid: string; deviceIp: string },
): RoomFixture {
  return {
    coordinatorUuid: partial.uuid,
    memberUuids: [partial.uuid],
    isCoordinator: true,
    volume: 30,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
    sourceKind: "idle",
    trackTitle: null,
    trackArtist: null,
    albumArtUri: null,
    ...partial,
  };
}

function silentHouse(): RoomFixture[] {
  return [
    room({ name: "Living Room", uuid: LR_UUID, deviceIp: LR_IP }),
    room({ name: "Desk", uuid: DESK_UUID, deviceIp: DESK_IP }),
    room({ name: "Bedroom", uuid: BEDROOM_UUID, deviceIp: BEDROOM_IP }),
    room({ name: "Bathroom", uuid: BATHROOM_UUID, deviceIp: BATHROOM_IP }),
    room({ name: "Kitchen", uuid: KITCHEN_UUID, deviceIp: KITCHEN_IP }),
  ];
}

describe("deriveSources , silent house", () => {
  const rooms = silentHouse();
  const sources = deriveSources(rooms);

  it("always renders exactly the two hardware floor cards", () => {
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.id)).toEqual(["src_desk_linein", "src_tv"]);
  });

  it("both floor cards report not playing, with no fabricated track line", () => {
    for (const s of sources) {
      expect(s.playing).toBe(false);
      expect(s.trackLine).toBeNull();
      expect(s.isSession).toBe(false);
    }
  });

  it("floor cards carry the right anchor identity and colors", () => {
    const [desk, tv] = sources;
    expect(desk).toMatchObject({
      anchorUuid: DESK_UUID,
      anchorIp: DESK_IP,
      roomName: "Desk",
      label: "Desk · Line-In",
      kind: "line-in",
      colorVar: "--acc",
    });
    expect(tv).toMatchObject({
      anchorUuid: LR_UUID,
      anchorIp: LR_IP,
      roomName: "Living Room",
      label: "Living Room · TV",
      kind: "tv",
      colorVar: "--amber",
    });
  });

  it("Desk stays selectable while idle, but the TV card is not (Apple TV off, www-tvoff)", () => {
    const [desk, tv] = sources;
    expect(desk.selectable).toBe(true);
    expect(tv.selectable).toBe(false);
  });

  it("membershipByUuid: anchors map to their own hardware card even while stopped", () => {
    const membership = membershipByUuid(rooms);
    expect(membership[DESK_UUID]).toBe("src_desk_linein");
    expect(membership[LR_UUID]).toBe("src_tv");
  });

  it("membershipByUuid: everyone else (non-anchor, idle) maps to null", () => {
    const membership = membershipByUuid(rooms);
    expect(membership[BEDROOM_UUID]).toBeNull();
    expect(membership[BATHROOM_UUID]).toBeNull();
    expect(membership[KITCHEN_UUID]).toBeNull();
  });
});

describe("deriveSources , live 3-source state (2026-07-11)", () => {
  function liveHouse(): RoomFixture[] {
    return [
      room({
        name: "Living Room",
        uuid: LR_UUID,
        deviceIp: LR_IP,
        transportState: "PLAYING",
        sourceLabel: "TV",
        sourceKind: "tv",
      }),
      room({
        name: "Desk",
        uuid: DESK_UUID,
        deviceIp: DESK_IP,
        transportState: "PLAYING",
        sourceLabel: "Line-In",
        sourceKind: "line-in",
      }),
      room({
        name: "Bedroom",
        uuid: BEDROOM_UUID,
        deviceIp: BEDROOM_IP,
        transportState: "PLAYING",
        sourceLabel: "Spotify",
        sourceKind: "spotify",
        trackTitle: "C'est La Vie",
        trackArtist: "Twin Diplomacy",
      }),
      room({ name: "Bathroom", uuid: BATHROOM_UUID, deviceIp: BATHROOM_IP }),
      room({
        // Kitchen has joined the Desk group; every follower carries the
        // coordinator's group-level values.
        name: "Kitchen",
        uuid: KITCHEN_UUID,
        deviceIp: KITCHEN_IP,
        coordinatorUuid: DESK_UUID,
        memberUuids: [DESK_UUID, KITCHEN_UUID],
        isCoordinator: false,
        transportState: "PLAYING",
        sourceLabel: "Line-In",
        sourceKind: "line-in",
      }),
    ];
  }

  it("produces desk floor, tv floor, and one bedroom session card , in that order", () => {
    const sources = deriveSources(liveHouse());
    expect(sources.map((s) => s.id)).toEqual([
      "src_desk_linein",
      "src_tv",
      `src_session_${BEDROOM_UUID}`,
    ]);
  });

  it("both hardware floor cards report playing:true", () => {
    const [desk, tv] = deriveSources(liveHouse());
    expect(desk.playing).toBe(true);
    expect(tv.playing).toBe(true);
    expect(desk.trackLine).toBeNull();
    expect(tv.trackLine).toBeNull();
    // TV is live (Apple TV on) , the TV card is selectable (www-tvoff).
    expect(tv.selectable).toBe(true);
  });

  it("the session card carries the formatted Artist — Title track line and SESSION badge", () => {
    const sources = deriveSources(liveHouse());
    const session = sources.find((s) => s.id === `src_session_${BEDROOM_UUID}`) as GroupSource;
    expect(session).toMatchObject({
      anchorUuid: BEDROOM_UUID,
      anchorIp: BEDROOM_IP,
      roomName: "Bedroom",
      label: "Bedroom · Spotify",
      kind: "spotify",
      playing: true,
      isSession: true,
      trackLine: "Twin Diplomacy — C'est La Vie",
      colorVar: SESSION_HUES[0],
    });
  });

  it("does not spawn a duplicate session card for the Desk group (dedup)", () => {
    const sources = deriveSources(liveHouse());
    expect(sources.some((s) => s.id === `src_session_${DESK_UUID}`)).toBe(false);
    expect(sources.some((s) => s.id === `src_session_${LR_UUID}`)).toBe(false);
    expect(sources).toHaveLength(3);
  });

  it("membershipByUuid: Kitchen (follower of the live Desk group) maps to the desk source", () => {
    const membership = membershipByUuid(liveHouse());
    expect(membership[KITCHEN_UUID]).toBe("src_desk_linein");
  });

  it("membershipByUuid: Bathroom (idle, own group) maps to null", () => {
    const membership = membershipByUuid(liveHouse());
    expect(membership[BATHROOM_UUID]).toBeNull();
  });

  it("membershipByUuid: Bedroom (its own live session) maps to its session id", () => {
    const membership = membershipByUuid(liveHouse());
    expect(membership[BEDROOM_UUID]).toBe(`src_session_${BEDROOM_UUID}`);
  });
});

describe("membershipByUuid , follower of a STOPPED hardware group", () => {
  // Regression: joining a speaker to the Desk group while line-in is not
  // playing must still read as membership (patch-bay wiring is topology, not
  // playback) , otherwise the optimistic join snaps back to "off" on the next
  // poll reconcile.
  function stoppedDeskGroupHouse(): RoomFixture[] {
    return [
      room({
        // Living Room has joined the (stopped) Desk group.
        name: "Living Room",
        uuid: LR_UUID,
        deviceIp: LR_IP,
        coordinatorUuid: DESK_UUID,
        memberUuids: [DESK_UUID, LR_UUID],
        isCoordinator: false,
      }),
      room({ name: "Desk", uuid: DESK_UUID, deviceIp: DESK_IP }),
      room({ name: "Bedroom", uuid: BEDROOM_UUID, deviceIp: BEDROOM_IP }),
    ];
  }

  it("Living Room (follower of the stopped Desk group) maps to the hardware card", () => {
    const membership = membershipByUuid(stoppedDeskGroupHouse());
    expect(membership[LR_UUID]).toBe("src_desk_linein");
  });

  it("Desk (anchor) still maps to its own hardware card", () => {
    const membership = membershipByUuid(stoppedDeskGroupHouse());
    expect(membership[DESK_UUID]).toBe("src_desk_linein");
  });

  it("Bedroom (idle, own group) stays null", () => {
    const membership = membershipByUuid(stoppedDeskGroupHouse());
    expect(membership[BEDROOM_UUID]).toBeNull();
  });
});

describe("deriveSources , Desk group playing Spotify (hardware anchor also has a live session)", () => {
  function deskSpotifyHouse(): RoomFixture[] {
    return [
      room({ name: "Living Room", uuid: LR_UUID, deviceIp: LR_IP }),
      room({
        name: "Desk",
        uuid: DESK_UUID,
        deviceIp: DESK_IP,
        transportState: "PLAYING",
        sourceLabel: "Spotify",
        sourceKind: "spotify",
        trackTitle: "C'est La Vie",
        trackArtist: "Twin Diplomacy",
      }),
      room({ name: "Bathroom", uuid: BATHROOM_UUID, deviceIp: BATHROOM_IP }),
      room({
        // Kitchen has joined the Desk group; every follower carries the
        // coordinator's group-level values.
        name: "Kitchen",
        uuid: KITCHEN_UUID,
        deviceIp: KITCHEN_IP,
        coordinatorUuid: DESK_UUID,
        memberUuids: [DESK_UUID, KITCHEN_UUID],
        isCoordinator: false,
        transportState: "PLAYING",
        sourceLabel: "Spotify",
        sourceKind: "spotify",
        trackTitle: "C'est La Vie",
        trackArtist: "Twin Diplomacy",
      }),
    ];
  }

  it("membershipByUuid: Kitchen (follower) maps to the live Desk session, not null", () => {
    const membership = membershipByUuid(deskSpotifyHouse());
    expect(membership[KITCHEN_UUID]).toBe(`src_session_${DESK_UUID}`);
  });

  it("membershipByUuid: Desk (anchor) maps to its own live session, not the stopped hardware card", () => {
    const membership = membershipByUuid(deskSpotifyHouse());
    expect(membership[DESK_UUID]).toBe(`src_session_${DESK_UUID}`);
  });
});

describe("deriveSources , phantom session from post-leave residue (STOPPED coordinator)", () => {
  // A speaker that just left a group often retains a stale line-in CurrentURI
  // pointed at ITS OWN uuid (not the Desk hardware anchor) while its transport
  // sits STOPPED , real post-leave shape verified live. That residue must never
  // spawn a session card; only a genuinely PLAYING/PAUSED coordinator counts.
  function postLeaveResidueHouse(): RoomFixture[] {
    return [
      room({ name: "Living Room", uuid: LR_UUID, deviceIp: LR_IP }),
      room({ name: "Desk", uuid: DESK_UUID, deviceIp: DESK_IP }),
      room({ name: "Bedroom", uuid: BEDROOM_UUID, deviceIp: BEDROOM_IP }),
      room({ name: "Bathroom", uuid: BATHROOM_UUID, deviceIp: BATHROOM_IP }),
      room({
        name: "Kitchen",
        uuid: KITCHEN_UUID,
        deviceIp: KITCHEN_IP,
        coordinatorUuid: KITCHEN_UUID,
        memberUuids: [KITCHEN_UUID],
        isCoordinator: true,
        transportState: "STOPPED",
        sourceLabel: "Line-In",
        sourceKind: "line-in",
      }),
    ];
  }

  it("does not spawn a phantom session card for the STOPPED residue coordinator", () => {
    const sources = deriveSources(postLeaveResidueHouse());
    expect(sources).toHaveLength(2);
    expect(sources.some((s) => s.id === `src_session_${KITCHEN_UUID}`)).toBe(false);
  });

  it("membershipByUuid: the residue room maps to null, not a phantom session", () => {
    const membership = membershipByUuid(postLeaveResidueHouse());
    expect(membership[KITCHEN_UUID]).toBeNull();
  });
});

describe("deriveSources , trackLine formatting", () => {
  it("falls back to title alone when artist is null", () => {
    const rooms = [
      room({ name: "Living Room", uuid: LR_UUID, deviceIp: LR_IP }),
      room({ name: "Desk", uuid: DESK_UUID, deviceIp: DESK_IP }),
      room({
        name: "Bedroom",
        uuid: BEDROOM_UUID,
        deviceIp: BEDROOM_IP,
        transportState: "PLAYING",
        sourceKind: "airplay",
        sourceLabel: "AirPlay",
        trackTitle: "Some Track",
        trackArtist: null,
      }),
      room({ name: "Bathroom", uuid: BATHROOM_UUID, deviceIp: BATHROOM_IP }),
      room({ name: "Kitchen", uuid: KITCHEN_UUID, deviceIp: KITCHEN_IP }),
    ];
    const session = deriveSources(rooms).find((s) => s.isSession) as GroupSource;
    expect(session.trackLine).toBe("Some Track");
  });

  it("is null when there is neither title nor artist", () => {
    const rooms = [
      room({ name: "Living Room", uuid: LR_UUID, deviceIp: LR_IP }),
      room({ name: "Desk", uuid: DESK_UUID, deviceIp: DESK_IP }),
      room({
        name: "Bedroom",
        uuid: BEDROOM_UUID,
        deviceIp: BEDROOM_IP,
        transportState: "PLAYING",
        sourceKind: "other",
        sourceLabel: null,
      }),
      room({ name: "Bathroom", uuid: BATHROOM_UUID, deviceIp: BATHROOM_IP }),
      room({ name: "Kitchen", uuid: KITCHEN_UUID, deviceIp: KITCHEN_IP }),
    ];
    const session = deriveSources(rooms).find((s) => s.isSession) as GroupSource;
    expect(session.trackLine).toBeNull();
  });
});

describe("deriveSources , ordering and color cycling across multiple sessions", () => {
  it("orders sessions by ROOM_ORDER rank of the coordinator room (Bedroom before Bathroom)", () => {
    const rooms = [
      room({ name: "Living Room", uuid: LR_UUID, deviceIp: LR_IP }),
      room({ name: "Desk", uuid: DESK_UUID, deviceIp: DESK_IP }),
      room({
        name: "Bathroom",
        uuid: BATHROOM_UUID,
        deviceIp: BATHROOM_IP,
        transportState: "PLAYING",
        sourceKind: "airplay",
        sourceLabel: "AirPlay",
      }),
      room({
        name: "Bedroom",
        uuid: BEDROOM_UUID,
        deviceIp: BEDROOM_IP,
        transportState: "PLAYING",
        sourceKind: "spotify",
        sourceLabel: "Spotify",
      }),
      room({ name: "Kitchen", uuid: KITCHEN_UUID, deviceIp: KITCHEN_IP }),
    ];
    const sources = deriveSources(rooms);
    expect(sources.map((s) => s.id)).toEqual([
      "src_desk_linein",
      "src_tv",
      `src_session_${BEDROOM_UUID}`,
      `src_session_${BATHROOM_UUID}`,
    ]);
  });

  it("cycles SESSION_HUES when more sessions exist than declared hues", () => {
    const rooms = [
      room({ name: "Living Room", uuid: LR_UUID, deviceIp: LR_IP }),
      room({ name: "Desk", uuid: DESK_UUID, deviceIp: DESK_IP }),
      room({
        name: "Bathroom",
        uuid: BATHROOM_UUID,
        deviceIp: BATHROOM_IP,
        transportState: "PLAYING",
        sourceKind: "airplay",
        sourceLabel: "AirPlay",
      }),
      room({
        name: "Bedroom",
        uuid: BEDROOM_UUID,
        deviceIp: BEDROOM_IP,
        transportState: "PLAYING",
        sourceKind: "spotify",
        sourceLabel: "Spotify",
      }),
      room({ name: "Kitchen", uuid: KITCHEN_UUID, deviceIp: KITCHEN_IP }),
    ];
    const sessions = deriveSources(rooms).filter((s) => s.isSession);
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(s.colorVar).toBe(SESSION_HUES[0 % SESSION_HUES.length]);
    }
  });
});
