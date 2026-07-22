/**
 * Tests for GroupsModal , container for the Sonos Groups detail page body
 * (www-51hf, Task 7).
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

// ── Mock tRPC ─────────────────────────────────────────────────────────────────

const {
  mockJoinMutate,
  mockLeaveMutate,
  mockGrabMutateAsync,
  mockSetLineInMutateAsync,
  mockInvalidate,
  callOrder,
  makeMutateMock,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  // mutate() wrappers run the mutate fn synchronously, and , matching
  // react-query , invoke BOTH the per-call onError (passed to .mutate) and the
  // hook-level onError (passed to .useMutation) when it throws, then always
  // fire onSettled. Tests simulate a failed join/leave with
  // mockJoinMutate.mockImplementationOnce(() => { throw new Error(...) }).
  function makeMutateMock(label: string, mutateFn: (input: unknown) => void) {
    return (hookOpts?: { onSettled?: () => void; onError?: (err: unknown) => void }) => ({
      mutate: (input: unknown, callOpts?: { onError?: (err: unknown) => void }) => {
        callOrder.push(label);
        try {
          mutateFn(input);
          hookOpts?.onSettled?.();
        } catch (err) {
          callOpts?.onError?.(err);
          hookOpts?.onError?.(err);
          hookOpts?.onSettled?.();
        }
      },
    });
  }
  return {
    mockJoinMutate: vi.fn(),
    mockLeaveMutate: vi.fn(),
    mockGrabMutateAsync: vi.fn().mockResolvedValue(undefined),
    mockSetLineInMutateAsync: vi.fn().mockResolvedValue(undefined),
    mockInvalidate: vi.fn().mockResolvedValue(undefined),
    callOrder,
    makeMutateMock,
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ media: { soundSystem: { invalidate: mockInvalidate } } }),
    media: {
      sonosGroupJoin: { useMutation: makeMutateMock("join", mockJoinMutate) },
      sonosGroupLeave: { useMutation: makeMutateMock("leave", mockLeaveMutate) },
      sonosGrabTvToBeam: {
        useMutation: (hookOpts?: { onSettled?: () => void }) => ({
          mutateAsync: async (input: unknown) => {
            callOrder.push("grab");
            const result = mockGrabMutateAsync(input);
            hookOpts?.onSettled?.();
            return result;
          },
        }),
      },
      sonosSetLineIn: {
        useMutation: (hookOpts?: { onSettled?: () => void }) => ({
          mutateAsync: async (input: unknown) => {
            callOrder.push("setLineIn");
            const result = mockSetLineInMutateAsync(input);
            hookOpts?.onSettled?.();
            return result;
          },
        }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockGrabMutateAsync.mockResolvedValue(undefined);
  mockSetLineInMutateAsync.mockResolvedValue(undefined);
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
    render(<GroupsModal rooms={[desk, tv, bedroom, kitchen]} dataUpdatedAt={1000} />);

    // Default selection: no source is playing -> falls back to src_desk_linein.
    // Desk's sourceKind is "idle" in this fixture, so a line-in grab lands
    // (awaited) before the join fires.
    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    await waitFor(() => expect(mockJoinMutate).toHaveBeenCalled());
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
    render(<GroupsModal rooms={[deskPlaying, tv, bedroomJoined, kitchen]} dataUpdatedAt={1000} />);

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

// NOTE: the TV source is selectable only while the Beam is actually on its TV
// input and playing (Apple TV on, www-tvoff) , at which point the beam is
// already on tv, so the grab-tv-to-beam path never fires through the UI. The
// former "TV grab ordering" tests selected an *idle* TV card, which is no
// longer possible, so they were removed. The desk line-in grab symmetry below
// still applies (the Desk card stays selectable while idle).
describe("GroupsModal , Desk line-in grab symmetry", () => {
  it("awaits sonosSetLineIn before firing sonosGroupJoin when the desk isn't already on line-in", async () => {
    render(<GroupsModal rooms={[desk, tv, bedroom, kitchen]} dataUpdatedAt={1000} />);

    // Default selection is Desk (nothing playing), desk sourceKind is "idle".
    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    await waitFor(() => expect(mockJoinMutate).toHaveBeenCalled());

    expect(mockSetLineInMutateAsync).toHaveBeenCalledWith({
      deviceIp: desk.deviceIp,
      sourceUuid: DESK_LINE_IN_UUID,
    });
    expect(mockJoinMutate).toHaveBeenCalledWith({
      memberIp: bedroom.deviceIp,
      coordinatorUuid: DESK_LINE_IN_UUID,
    });
    expect(callOrder.indexOf("setLineIn")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("setLineIn")).toBeLessThan(callOrder.indexOf("join"));
  });

  it("does not grab the desk line-in when it's already on line-in", async () => {
    const deskOnLineIn = room({ ...desk, sourceKind: "line-in" });
    render(<GroupsModal rooms={[deskOnLineIn, tv, bedroom, kitchen]} dataUpdatedAt={1000} />);

    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    await waitFor(() => expect(mockJoinMutate).toHaveBeenCalled());
    expect(mockSetLineInMutateAsync).not.toHaveBeenCalled();
  });

  it("aborts the join and reverts the optimistic LED when the desk grab rejects", async () => {
    mockSetLineInMutateAsync.mockRejectedValueOnce(new Error("desk grab failed"));
    render(<GroupsModal rooms={[desk, tv, bedroom, kitchen]} dataUpdatedAt={1000} />);

    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    await waitFor(() => expect(mockSetLineInMutateAsync).toHaveBeenCalled());
    expect(mockJoinMutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Bedroom, off")).toBeInTheDocument();
    expect(screen.getByText("desk grab failed")).toBeInTheDocument();
  });
});

describe("GroupsModal , join/leave mutation error reverts optimistic state", () => {
  it("reverts the optimistic LED when sonosGroupJoin itself fails", async () => {
    mockJoinMutate.mockImplementationOnce(() => {
      throw new Error("join failed");
    });
    const deskOnLineIn = room({ ...desk, sourceKind: "line-in" });
    render(<GroupsModal rooms={[deskOnLineIn, tv, bedroom, kitchen]} dataUpdatedAt={1000} />);

    fireEvent.click(screen.getByLabelText("Bedroom, off"));

    await waitFor(() => expect(screen.getByText("join failed")).toBeInTheDocument());
    expect(screen.getByLabelText("Bedroom, off")).toBeInTheDocument();
  });

  it("reverts the optimistic LED when sonosGroupLeave itself fails", async () => {
    mockLeaveMutate.mockImplementationOnce(() => {
      throw new Error("leave failed");
    });
    const deskPlaying = room({ ...desk, transportState: "PLAYING", sourceKind: "line-in" });
    const bedroomJoined = { ...bedroom, coordinatorUuid: DESK_LINE_IN_UUID };
    render(<GroupsModal rooms={[deskPlaying, tv, bedroomJoined, kitchen]} dataUpdatedAt={1000} />);

    fireEvent.click(screen.getByLabelText("Bedroom, following Desk"));

    await waitFor(() => expect(screen.getByText("leave failed")).toBeInTheDocument());
    expect(screen.getByLabelText("Bedroom, following Desk")).toBeInTheDocument();
  });
});

describe("GroupsModal , anchor captured by another group", () => {
  // Regression: join Desk into the TV group, then select the Desk source ,
  // the Desk row must stay tappable so it can be pulled back out; the anchor
  // lock only applies while the anchor actually stands alone / drives its
  // own source.
  const tvPlaying = room({ ...tv, transportState: "PLAYING", sourceKind: "tv" });
  const deskCaptured = room({ ...desk, coordinatorUuid: BEAM_UUID, isCoordinator: false });

  it("tapping the captured anchor with its own source selected fires sonosGroupLeave", async () => {
    render(
      <GroupsModal rooms={[deskCaptured, tvPlaying, bedroom, kitchen]} dataUpdatedAt={1000} />,
    );

    // Select the Desk source, then tap the Desk speaker row (currently
    // following Living Room) to release it back to standalone.
    fireEvent.click(screen.getByLabelText("Select Desk · Line-In"));
    fireEvent.click(screen.getByLabelText("Desk, following Living Room"));

    expect(mockLeaveMutate).toHaveBeenCalledWith({
      memberIp: deskCaptured.deviceIp,
      memberUuid: DESK_LINE_IN_UUID,
    });
    expect(mockJoinMutate).not.toHaveBeenCalled();
    // Optimistic LED: desk now reads as with its own source.
    expect(screen.getByLabelText("Desk, following Desk")).toBeInTheDocument();
  });

  it("tapping a standalone anchor with its own source selected stays a no-op", () => {
    render(<GroupsModal rooms={[desk, tv, bedroom, kitchen]} dataUpdatedAt={1000} />);

    // Default selection is Desk; the Desk row anchors it and stands alone.
    fireEvent.click(screen.getByLabelText("Desk, following Desk"));

    expect(mockLeaveMutate).not.toHaveBeenCalled();
    expect(mockJoinMutate).not.toHaveBeenCalled();
  });
});

describe("GroupsModal , invalidate", () => {
  it("invalidates soundSystem after a join mutation settles", async () => {
    render(<GroupsModal rooms={[desk, tv, bedroom, kitchen]} dataUpdatedAt={1000} />);
    fireEvent.click(screen.getByLabelText("Bedroom, off"));
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
  });

  it("invalidates soundSystem after a leave mutation settles", async () => {
    const deskPlaying = room({ ...desk, transportState: "PLAYING", sourceKind: "line-in" });
    const bedroomJoined = { ...bedroom, coordinatorUuid: DESK_LINE_IN_UUID };
    render(<GroupsModal rooms={[deskPlaying, tv, bedroomJoined, kitchen]} dataUpdatedAt={1000} />);
    fireEvent.click(screen.getByLabelText("Bedroom, following Desk"));
    expect(mockInvalidate).toHaveBeenCalled();
  });
});
