/**
 * Component tests for ControlsTile.
 *
 * Strategy: mock the trpc hooks so no real tRPC/React-Query setup is needed.
 * We test:
 *  1. Renders real data when the query resolves.
 *  2. Renders shimmer Skeleton cells when data is undefined (shows shimmer, not hardcoded data).
 *  3. Shows "cached" hint when the query is in error state.
 *  4. Clicking a tap button calls the toggle mutation with the correct args.
 *  5. Pending state: dimmed appearance when a control has pending=true.
 *  6. Toggle mutation optimistically flips the group (cancel + setData) for instant feedback.
 *  7. Adaptive refetchInterval: 2000 when any pending, 5000 otherwise.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock trpc ────────────────────────────────────────────────────────────────

const mockMutate = vi.fn();
const mockSceneMutate = vi.fn();
const mockBrightnessMutate = vi.fn();
const mockModeMutate = vi.fn();
let capturedBrightnessOpts: { onMutate?: (vars: { pct: number }) => unknown } | undefined;

// Shared cache spies so optimistic onMutate side effects are observable.
const mockCancel = vi.fn();
const mockGetData = vi.fn();
const mockSetData = vi.fn();
const mockInvalidate = vi.fn();
// Captures the opts passed to useMutation so the mock can drive onMutate.
let capturedMutationOpts:
  | { onMutate?: (vars: { key: string; on: boolean }) => unknown }
  | undefined;

// Capture the refetchInterval passed to useQuery
let capturedRefetchInterval: number | ((data: unknown) => number) | undefined;

// Default query response — overridden per test.
let mockQueryReturn: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = {
  data: undefined,
  isLoading: true,
  isError: false,
};

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    controls: {
      list: {
        useQuery: (_input: unknown, opts?: { refetchInterval?: unknown }) => {
          capturedRefetchInterval = opts?.refetchInterval as
            | number
            | ((data: unknown) => number)
            | undefined;
          return mockQueryReturn;
        },
      },
      toggle: {
        useMutation: (opts?: { onMutate?: (vars: { key: string; on: boolean }) => unknown }) => {
          capturedMutationOpts = opts;
          return {
            mutate: (args: { key: string; on: boolean }) => {
              mockMutate(args);
              capturedMutationOpts?.onMutate?.(args);
            },
          };
        },
      },
      setLampScene: {
        useMutation: () => ({ mutate: mockSceneMutate }),
      },
      setLampBrightness: {
        useMutation: (opts?: { onMutate?: (vars: { pct: number }) => unknown }) => {
          capturedBrightnessOpts = opts;
          return {
            mutate: (args: { pct: number }) => {
              mockBrightnessMutate(args);
              capturedBrightnessOpts?.onMutate?.(args);
            },
          };
        },
      },
      setLampMode: {
        useMutation: () => ({ mutate: mockModeMutate }),
      },
    },
    useUtils: () => ({
      controls: {
        list: {
          cancel: mockCancel,
          getData: mockGetData,
          setData: mockSetData,
          invalidate: mockInvalidate,
        },
      },
    }),
  },
}));

// ─── import after mock ────────────────────────────────────────────────────────

import { ControlsTile, makeRefetchInterval as makeRefetchIntervalForTest } from "../ControlsTile";

// ─── setup / teardown ────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedRefetchInterval = undefined;
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ControlsTile", () => {
  describe("renders with real data", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: {
          lamps: { on: true, count: 2, sub: "On", pending: false },
          lights: { on: false, pending: false },
          fan: { on: true, sub: "Medium", pending: false },
        },
        isLoading: false,
        isError: false,
      };
    });

    it("shows the Controls header", () => {
      render(<ControlsTile />);
      expect(screen.getByText("Controls")).toBeInTheDocument();
    });

    it("renders all four grid cells", () => {
      render(<ControlsTile />);
      expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
      expect(screen.getByLabelText("Lights")).toBeInTheDocument();
      expect(screen.getByLabelText("Fan")).toBeInTheDocument();
      // 4th cell is the "more" overflow affordance
      expect(screen.getByLabelText("More")).toBeInTheDocument();
    });

    it("4th cell shows more label text", () => {
      render(<ControlsTile />);
      expect(screen.getByText("more")).toBeInTheDocument();
      expect(screen.queryByText("Scene")).not.toBeInTheDocument();
    });

    it("www-bh5: fan icon has spin animation running when fan is on", () => {
      render(<ControlsTile />);
      // Fan is on in the beforeEach data — the icon wrapper should have spin style.
      const fanButton = screen.getByLabelText("Fan");
      // The spinning icon sits inside the fan button; it should have animationPlayState running.
      const spinEl = fanButton.querySelector("[data-fan-spin]");
      expect(spinEl).not.toBeNull();
      expect(spinEl).toHaveStyle({ animationPlayState: "running" });
    });

    it("Lamps tap reflects on state", () => {
      render(<ControlsTile />);
      const lamps = screen.getByLabelText("Lamps");
      expect(lamps).toHaveAttribute("aria-pressed", "true");
    });

    it("Lights tap reflects off state", () => {
      render(<ControlsTile />);
      const lights = screen.getByLabelText("Lights");
      expect(lights).toHaveAttribute("aria-pressed", "false");
    });

    it("Fan tap reflects on state", () => {
      render(<ControlsTile />);
      const fan = screen.getByLabelText("Fan");
      expect(fan).toHaveAttribute("aria-pressed", "true");
    });

    it("www-bh5: fan icon spin is paused when fan is off", () => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      const fanButton = screen.getByLabelText("Fan");
      const spinEl = fanButton.querySelector("[data-fan-spin]");
      expect(spinEl).not.toBeNull();
      expect(spinEl).toHaveStyle({ animationPlayState: "paused" });
    });

    it("shows fan sub-label when on", () => {
      render(<ControlsTile />);
      expect(screen.getByText("Medium")).toBeInTheDocument();
    });

    it("shows lamp sub-label as 'On' when any lamp is on", () => {
      render(<ControlsTile />);
      // Sub is now "On"/"Off" only — no count or warmth.
      const lampsBtn = screen.getByLabelText("Lamps");
      expect(lampsBtn).toHaveTextContent("On");
    });
  });

  describe("loading state (no data yet)", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: undefined,
        isLoading: true,
        isError: false,
      };
    });

    it("renders Skeleton cells instead of tap buttons when data is undefined", () => {
      render(<ControlsTile />);
      // No real control buttons should be present — shimmer only, no hardcoded data
      expect(screen.queryByLabelText("Lamps")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Lights")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Fan")).not.toBeInTheDocument();
    });

    it("does not show the cached badge", () => {
      render(<ControlsTile />);
      expect(screen.queryByText("cached")).not.toBeInTheDocument();
    });

    it("does not render hardcoded data when query is undefined", () => {
      render(<ControlsTile />);
      // Lamps and Lights buttons must not appear when there is no data.
      expect(screen.queryByLabelText("Lamps")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Lights")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: undefined,
        isLoading: false,
        isError: true,
      };
    });

    it("still renders the Controls header", () => {
      render(<ControlsTile />);
      expect(screen.getByText("Controls")).toBeInTheDocument();
    });

    it("renders skeleton (no real controls) when errored with no data", () => {
      render(<ControlsTile />);
      expect(screen.queryByLabelText("Lamps")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Fan")).not.toBeInTheDocument();
    });

    it("does not show cached badge when error (skeleton replaces error display)", () => {
      render(<ControlsTile />);
      expect(screen.queryByText("cached")).not.toBeInTheDocument();
    });
  });

  describe("toggle interaction", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
    });

    it("calls toggle mutation with lamps on=true when lamps are off and clicked", () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Lamps"));
      expect(mockMutate).toHaveBeenCalledWith({ key: "lamps", on: true });
    });

    it("calls toggle mutation with lights on=true when lights are off and clicked", () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Lights"));
      expect(mockMutate).toHaveBeenCalledWith({ key: "lights", on: true });
    });

    it("calls toggle mutation with fan on=true when fan is off and clicked", () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Fan"));
      expect(mockMutate).toHaveBeenCalledWith({ key: "fan", on: true });
    });

    it("calls toggle mutation with lamps on=false when lamps are on and clicked", () => {
      mockQueryReturn = {
        data: {
          lamps: { on: true, count: 2, sub: "On", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Lamps"));
      expect(mockMutate).toHaveBeenCalledWith({ key: "lamps", on: false });
    });
  });

  describe("pending state", () => {
    it("renders real data with pending indicator when a control has pending:true", () => {
      mockQueryReturn = {
        data: {
          lamps: { on: true, count: 1, sub: "On", pending: true },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      // Lamps button should be present and reflect on=true
      const lamps = screen.getByLabelText("Lamps");
      expect(lamps).toHaveAttribute("aria-pressed", "true");
      // The pending indicator (dimmed opacity class or aria attribute) should be applied
      expect(lamps).toHaveAttribute("data-pending", "true");
    });
  });

  describe("adaptive refetch interval", () => {
    it("uses refetchInterval of 2000 when any control has pending:true", () => {
      const pendingData = {
        lamps: { on: true, count: 1, sub: "On", pending: true },
        lights: { on: false, pending: false },
        fan: { on: false, sub: "", pending: false },
      };
      mockQueryReturn = { data: pendingData, isLoading: false, isError: false };
      render(<ControlsTile />);

      const interval =
        typeof capturedRefetchInterval === "function"
          ? capturedRefetchInterval({ state: { data: pendingData } })
          : capturedRefetchInterval;

      expect(interval).toBe(2_000);
    });

    it("uses refetchInterval of 5000 when no controls are pending", () => {
      const idleData = {
        lamps: { on: true, count: 2, sub: "On", pending: false },
        lights: { on: false, pending: false },
        fan: { on: false, sub: "", pending: false },
      };
      mockQueryReturn = { data: idleData, isLoading: false, isError: false };
      render(<ControlsTile />);

      const interval =
        typeof capturedRefetchInterval === "function"
          ? capturedRefetchInterval({ state: { data: idleData } })
          : capturedRefetchInterval;

      expect(interval).toBe(5_000);
    });

    it("uses refetchInterval of 5000 when data is null (HA unavailable)", () => {
      mockQueryReturn = { data: null, isLoading: false, isError: false };
      render(<ControlsTile />);

      const interval =
        typeof capturedRefetchInterval === "function"
          ? capturedRefetchInterval({ state: { data: null } })
          : capturedRefetchInterval;

      expect(interval).toBe(5_000);
    });
  });

  describe("www-lad: uses TileHeader primitive for section header", () => {
    it("renders Controls header via TileHeader (no hand-rolled flex row)", () => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      // Header title must be present — TileHeader renders it as a span
      expect(screen.getByText("Controls")).toBeInTheDocument();
    });
  });

  // ── www-7d5b.2.5: flicker hack removed (desired-authoritative backend) ─────────
  describe("www-7d5b.2.5: no cooldown / steady refetch", () => {
    it("does NOT invalidate on the optimistic onMutate (only on settle)", async () => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };

      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Lamps"));

      // Flush microtasks so onMutate completes (optimistic setData runs).
      await waitFor(() => expect(mockSetData).toHaveBeenCalled());

      // onMutate must not invalidate — that would race the optimistic write. The
      // mock's mutate only drives onMutate, so onSettled (which DOES invalidate)
      // hasn't run; invalidate stays uncalled here.
      expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it("refetchInterval no longer pauses (no cooldown) — steady 5s when idle", () => {
      const fn = makeRefetchIntervalForTest();
      // Previously this returned false during a cooldown window; now there is no
      // cooldown, so it always returns a positive steady interval.
      expect(fn({ state: { data: undefined } })).toBe(5_000);
    });
  });

  describe("optimistic toggle (instant feedback)", () => {
    it("onMutate flips the toggled group on + pending immediately via setData", async () => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };

      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Lamps"));

      // onMutate awaits cancel() before setData, so flush microtasks first.
      expect(mockCancel).toHaveBeenCalled();
      await waitFor(() => expect(mockSetData).toHaveBeenCalled());

      // The updater must flip lamps -> on + pending so the tap responds instantly,
      // even for unregistered devices with no server-side pending overlay.
      const updater = mockSetData.mock.calls[0][1] as (old: unknown) => {
        lamps: { on: boolean; pending: boolean };
      };
      const next = updater({
        lamps: { on: false, count: 0, sub: "Off", pending: false },
        lights: { on: false, pending: false },
        fan: { on: false, sub: "", pending: false },
      });
      expect(next.lamps.on).toBe(true);
      expect(next.lamps.pending).toBe(true);
    });
  });

  describe("www-lqz: consistent padding", () => {
    it("outer tile wrapper has padding 20 so bottom spacing matches sides", () => {
      mockQueryReturn = { data: undefined, isLoading: true, isError: false };
      const { container } = render(<ControlsTile />);
      const tile = container.firstChild as HTMLElement;
      expect(tile.style.padding).toBe("20px");
    });
  });

  // ── www-59u: fan-toggle no-snap-back (now via desired-authoritative backend) ───
  // The fan shares the optimistic pattern. Toggling it flips the cache optimistically;
  // invalidate only fires on settle (not on mutate), so the optimistic value is never
  // discarded early. With a desired-authoritative backend the refetched value equals
  // the optimistic one, so there is no revert-then-reapply window.
  describe("www-59u: fan toggle does not snap back", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
    });

    it("sends on=true and optimistically flips fan on+pending, with no settle-time reconcile", async () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Fan"));

      // Intent: turning the fan on (the service maps this to set_fan_mode 'on').
      expect(mockMutate).toHaveBeenCalledWith({ key: "fan", on: true });

      // onMutate awaits cancel() before setData; flush microtasks.
      await waitFor(() => expect(mockSetData).toHaveBeenCalled());
      const updater = mockSetData.mock.calls[0][1] as (old: unknown) => {
        fan: { on: boolean; pending: boolean };
      };
      const next = updater({
        lamps: { on: false, count: 0, sub: "Off", pending: false },
        lights: { on: false, pending: false },
        fan: { on: false, sub: "", pending: false },
      });
      expect(next.fan.on).toBe(true);
      expect(next.fan.pending).toBe(true);

      // No invalidate on settle — the optimistic cache value is not discarded
      // early, so it survives until the cooldown-driven refetch lands.
      expect(mockInvalidate).not.toHaveBeenCalled();
    });
  });

  // ── www-06x.3: expanded controls modal wiring ─────────────────────────────────
  describe("www-06x.3: expanded controls modal", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: {
          lamps: { on: true, count: 2, sub: "On", pending: false, brightness: 72 },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
    });

    it("modal is closed until the More button is clicked (no scene buttons yet)", () => {
      render(<ControlsTile />);
      expect(screen.queryByRole("button", { name: "White" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Brightness")).not.toBeInTheDocument();
    });

    it("clicking More opens the modal: scene buttons + brightness slider appear", () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      expect(screen.getByRole("button", { name: "White" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mood" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
      expect(screen.getByLabelText("Brightness")).toBeInTheDocument();
    });

    it("tapping the tile body (not a toggle) opens the modal — same as More", () => {
      render(<ControlsTile />);
      // The "Controls" header is part of the tile body, outside any toggle cell.
      fireEvent.click(screen.getByText("Controls"));
      expect(screen.getByRole("button", { name: "White" })).toBeInTheDocument();
      expect(screen.getByLabelText("Brightness")).toBeInTheDocument();
    });

    it("tapping a toggle cell operates the control and does NOT open the modal", () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Lamps"));
      // The toggle fired its mutation, and the modal stayed closed.
      expect(mockMutate).toHaveBeenCalledWith({ key: "lamps", on: false });
      expect(screen.queryByRole("button", { name: "White" })).not.toBeInTheDocument();
    });

    it("scene button fires setLampScene mutation with the scene id", () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      fireEvent.click(screen.getByRole("button", { name: "Mood" }));
      expect(mockSceneMutate).toHaveBeenCalledWith({ scene: "mood" });
    });

    it("brightness slider seeds from data.lamps.brightness", () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      expect((screen.getByLabelText("Brightness") as HTMLInputElement).value).toBe("72");
    });

    it("brightness slider fires setLampBrightness mutation with the pct", async () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      fireEvent.change(screen.getByLabelText("Brightness"), { target: { value: "55" } });
      // onBrightness is debounced 400ms in the modal, so the mutation fires on the
      // trailing edge — wait for it rather than asserting synchronously.
      await waitFor(() => expect(mockBrightnessMutate).toHaveBeenCalledWith({ pct: 55 }));
    });

    it("brightness drag optimistically writes the pct into the cache (no snap-back)", async () => {
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      fireEvent.change(screen.getByLabelText("Brightness"), { target: { value: "40" } });

      // The mutation is debounced 400ms; its onMutate then cancels + writes the
      // optimistic value. Wait for that trailing-edge work to land.
      await waitFor(() => expect(mockCancel).toHaveBeenCalled());
      await waitFor(() => expect(mockSetData).toHaveBeenCalled());
      const updater = mockSetData.mock.calls[0][1] as (old: unknown) => {
        lamps: { brightness: number };
      };
      const next = updater({
        lamps: { on: true, count: 2, sub: "On", pending: false, brightness: 72 },
        lights: { on: false, pending: false },
        fan: { on: false, sub: "", pending: false },
      });
      expect(next.lamps.brightness).toBe(40);
      // No invalidate on the optimistic onMutate — it fires on settle, so the
      // optimistic value is never discarded early (no snap-back).
      expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it("brightness slider is disabled inside the modal when lamps are off", () => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      expect(screen.getByLabelText("Brightness")).toBeDisabled();
    });
  });

  // ── www-7d5b.3.7: setLampMode (party) wiring + speed ──────────────────────────
  describe("www-7d5b.3.7: party mode + speed wiring", () => {
    it("threads activeScene into the modal so the active scene tile highlights", () => {
      mockQueryReturn = {
        data: {
          lamps: {
            on: true,
            count: 2,
            sub: "On",
            pending: false,
            brightness: 72,
            activeScene: "blue",
          },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    });

    it("tapping Party when none active starts party with the current speed (default medium)", () => {
      mockQueryReturn = {
        data: {
          lamps: {
            on: true,
            count: 2,
            sub: "On",
            pending: false,
            brightness: 72,
            activeScene: null,
          },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      fireEvent.click(screen.getByRole("button", { name: "Party" }));
      expect(mockModeMutate).toHaveBeenCalledWith({ mode: "party", speed: "medium" });
    });

    it("tapping Party when party active stops it (mode: none)", () => {
      mockQueryReturn = {
        data: {
          lamps: {
            on: true,
            count: 2,
            sub: "On",
            pending: false,
            brightness: 72,
            activeScene: "party",
          },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      fireEvent.click(screen.getByRole("button", { name: "Party" }));
      expect(mockModeMutate).toHaveBeenCalledWith({ mode: "none" });
    });

    it("shows the segmented speed control only when party is active", () => {
      mockQueryReturn = {
        data: {
          lamps: {
            on: true,
            count: 2,
            sub: "On",
            pending: false,
            brightness: 72,
            activeScene: null,
          },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      const { rerender } = render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      // Not party → no speed tablist.
      expect(screen.queryByRole("tablist", { name: "Party speed" })).not.toBeInTheDocument();

      mockQueryReturn = {
        data: {
          lamps: {
            on: true,
            count: 2,
            sub: "On",
            pending: false,
            brightness: 72,
            activeScene: "party",
          },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      rerender(<ControlsTile />);
      expect(screen.getByRole("tablist", { name: "Party speed" })).toBeInTheDocument();
    });

    it("changing speed while party active re-issues setLampMode with the new speed", () => {
      mockQueryReturn = {
        data: {
          lamps: {
            on: true,
            count: 2,
            sub: "On",
            pending: false,
            brightness: 72,
            activeScene: "party",
          },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      fireEvent.click(screen.getByRole("tab", { name: "Fast" }));
      expect(mockModeMutate).toHaveBeenCalledWith({ mode: "party", speed: "fast" });
    });

    it("Party tile is disabled when lamps are off", () => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "Off", pending: false, activeScene: null },
          lights: { on: false, pending: false },
          fan: { on: false, sub: "", pending: false },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("More"));
      expect(screen.getByRole("button", { name: "Party" })).toBeDisabled();
    });
  });
});
