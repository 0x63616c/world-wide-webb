/**
 * Tests for GroupsModal , container for the Sonos Groups modal (www-51hf, Task 7).
 *
 * Wires deriveSources/membershipByUuid/useGroupMembership to GroupsModalView and
 * fires the sonosGroupJoin/sonosGroupLeave/sonosGrabTvToBeam mutations. Mocks
 * @/lib/trpc the same way __tests__/TvNowPlayingTile.test.tsx does (the container
 * mock pattern for this codebase , SoundSystemTile.test.tsx tests the dumb view
 * only and has no trpc mock).
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupsModal } from "../GroupsModal";
import type { SoundSystemRoom } from "../lib/derive-sources";
import { BEAM_UUID, DESK_LINE_IN_UUID } from "../lib/sonos-constants";

// ── Mock portals and modal-open-store for modal rendering ────────────────────
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return {
    ...original,
    createPortal: (node: React.ReactNode) => node,
  };
});

vi.mock("@/lib/modal-open-store", () => ({
  registerOpenModal: vi.fn(() => () => {}),
}));

// ── Mock tRPC ─────────────────────────────────────────────────────────────────

const mockJoinMutate = vi.fn();
const mockLeaveMutate = vi.fn();
const mockGrabMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockInvalidate = vi.fn().mockResolvedValue(undefined);

type Opts = { onSettled?: () => void };
const capturedOpts: { join?: Opts; leave?: Opts; grab?: Opts } = {};
const callOrder: string[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ media: { soundSystem: { invalidate: mockInvalidate } } }),
    media: {
      sonosGroupJoin: {
        useMutation: (opts?: Opts) => {
          capturedOpts.join = opts;
          return {
            mutate: (input: unknown) => {
              callOrder.push("join");
              mockJoinMutate(input);
              opts?.onSettled?.();
            },
          };
        },
      },
      sonosGroupLeave: {
        useMutation: (opts?: Opts) => {
          capturedOpts.leave = opts;
          return {
            mutate: (input: unknown) => {
              callOrder.push("leave");
              mockLeaveMutate(input);
              opts?.onSettled?.();
            },
          };
        },
      },
      sonosGrabTvToBeam: {
        useMutation: (opts?: Opts) => {
          capturedOpts.grab = opts;
          return {
            mutateAsync: async (input: unknown) => {
              callOrder.push("grab");
              mockGrabMutateAsync(input);
              opts?.onSettled?.();
              return undefined;
            },
          };
        },
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  callOrder.length = 0;
});

// ── Room fixtures ─────────────────────────────────────────────────────────────

function room(overrides: Partial<SoundSystemRoom>): SoundSystemRoom {
  return {
    uuid: "uuid-x",
    deviceIp: "192.168.0.9",
    coordinatorUuid: "uuid-x",
    memberUuids: ["uuid-x"],
    name: "Room",
    isCoordinator: true,
    volume: 30,
    muted: false,
    transportState: "STOPPED",
    sourceLabel: null,
    sourceKind: "idle",
    trackTitle: null,
    trackArtist: null,
    albumArtUri: null,
    ...overrides,
  };
}

const desk = room({
  uuid: DESK_LINE_IN_UUID,
  deviceIp: "192.168.0.2",
  coordinatorUuid: DESK_LINE_IN_UUID,
  memberUuids: [DESK_LINE_IN_UUID],
  name: "Desk",
  sourceKind: "idle",
});

const tv = room({
  uuid: BEAM_UUID,
  deviceIp: "192.168.0.1",
  coordinatorUuid: BEAM_UUID,
  memberUuids: [BEAM_UUID],
  name: "Living Room",
  sourceKind: "idle",
});

const bedroom = room({
  uuid: "uuid-bed",
  deviceIp: "192.168.0.3",
  coordinatorUuid: "uuid-bed",
  memberUuids: ["uuid-bed"],
  name: "Bedroom",
});

const kitchen = room({
  uuid: "uuid-kit",
  deviceIp: "192.168.0.4",
  coordinatorUuid: "uuid-kit",
  memberUuids: ["uuid-kit"],
  name: "Kitchen",
});

describe("GroupsModal , join (idle speaker tap)", () => {
  it("fires sonosGroupJoin with the selected source's anchorUuid and shows optimistic LED", async () => {
    render(
      <GroupsModal
        open
        onClose={vi.fn()}
        rooms={[desk, tv, bedroom, kitchen]}
        dataUpdatedAt={1000}
      />,
    );

    // Default selection: no source is playing -> falls back to src_desk_linein.
    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    expect(mockJoinMutate).toHaveBeenCalledWith({
      memberIp: bedroom.deviceIp,
      coordinatorUuid: DESK_LINE_IN_UUID,
    });
    // Optimistic LED: the speaker row now reads as following Desk.
    expect(screen.getByLabelText("Bedroom, following Desk")).toBeInTheDocument();
  });
});

describe("GroupsModal , leave (member speaker tap)", () => {
  it("fires sonosGroupLeave for a room already following the selected source", async () => {
    const deskPlaying = room({ ...desk, transportState: "PLAYING", sourceKind: "line-in" });
    const bedroomJoined = { ...bedroom, coordinatorUuid: DESK_LINE_IN_UUID };
    render(
      <GroupsModal
        open
        onClose={vi.fn()}
        rooms={[deskPlaying, tv, bedroomJoined, kitchen]}
        dataUpdatedAt={1000}
      />,
    );

    // Desk is playing -> it's the default selection, and bedroom already follows it.
    expect(screen.getByLabelText("Bedroom, following Desk")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Bedroom, following Desk"));

    expect(mockLeaveMutate).toHaveBeenCalledWith({
      memberIp: bedroomJoined.deviceIp,
      memberUuid: bedroomJoined.uuid,
    });
    expect(screen.getByLabelText("Bedroom, off")).toBeInTheDocument();
  });
});

describe("GroupsModal , TV grab ordering", () => {
  it("awaits sonosGrabTvToBeam before firing sonosGroupJoin when the beam isn't already on tv", async () => {
    render(
      <GroupsModal
        open
        onClose={vi.fn()}
        rooms={[desk, tv, bedroom, kitchen]}
        dataUpdatedAt={1000}
      />,
    );

    fireEvent.click(screen.getByLabelText("Select Living Room · TV"));
    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    await waitFor(() => expect(mockJoinMutate).toHaveBeenCalled());

    expect(mockGrabMutateAsync).toHaveBeenCalledWith({
      beamIp: tv.deviceIp,
      beamUuid: BEAM_UUID,
    });
    expect(mockJoinMutate).toHaveBeenCalledWith({
      memberIp: bedroom.deviceIp,
      coordinatorUuid: BEAM_UUID,
    });
    expect(callOrder.indexOf("grab")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("grab")).toBeLessThan(callOrder.indexOf("join"));
  });

  it("does not grab the TV when the beam is already on tv", async () => {
    const tvOnAlready = room({ ...tv, sourceKind: "tv" });
    render(
      <GroupsModal
        open
        onClose={vi.fn()}
        rooms={[desk, tvOnAlready, bedroom, kitchen]}
        dataUpdatedAt={1000}
      />,
    );

    fireEvent.click(screen.getByLabelText("Select Living Room · TV"));
    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    await waitFor(() => expect(mockJoinMutate).toHaveBeenCalled());
    expect(mockGrabMutateAsync).not.toHaveBeenCalled();
  });
});

describe("GroupsModal , ALL", () => {
  it("joins every non-anchor speaker that isn't already a member to the selected source", async () => {
    const deskPlaying = room({ ...desk, transportState: "PLAYING", sourceKind: "line-in" });
    const bedroomJoined = { ...bedroom, coordinatorUuid: DESK_LINE_IN_UUID };
    render(
      <GroupsModal
        open
        onClose={vi.fn()}
        rooms={[deskPlaying, tv, bedroomJoined, kitchen]}
        dataUpdatedAt={1000}
      />,
    );

    fireEvent.click(screen.getByLabelText("Send all speakers to Desk · Line-In"));

    // Bedroom already follows Desk -> not re-joined. Kitchen is idle -> joined.
    // Desk and Living Room (TV anchor) are anchors of other sources -> never joined.
    expect(mockJoinMutate).toHaveBeenCalledTimes(1);
    expect(mockJoinMutate).toHaveBeenCalledWith({
      memberIp: kitchen.deviceIp,
      coordinatorUuid: DESK_LINE_IN_UUID,
    });
  });
});

describe("GroupsModal , invalidate", () => {
  it("invalidates soundSystem after a join mutation settles", async () => {
    render(
      <GroupsModal
        open
        onClose={vi.fn()}
        rooms={[desk, tv, bedroom, kitchen]}
        dataUpdatedAt={1000}
      />,
    );
    fireEvent.click(screen.getByLabelText("Bedroom, off"));
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("invalidates soundSystem after a leave mutation settles", async () => {
    const deskPlaying = room({ ...desk, transportState: "PLAYING", sourceKind: "line-in" });
    const bedroomJoined = { ...bedroom, coordinatorUuid: DESK_LINE_IN_UUID };
    render(
      <GroupsModal
        open
        onClose={vi.fn()}
        rooms={[deskPlaying, tv, bedroomJoined, kitchen]}
        dataUpdatedAt={1000}
      />,
    );
    fireEvent.click(screen.getByLabelText("Bedroom, following Desk"));
    expect(mockInvalidate).toHaveBeenCalled();
  });
});
