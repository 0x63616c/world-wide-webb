/**
 * Component tests for ControlsTile.
 *
 * Strategy: mock the trpc hooks so no real tRPC/React-Query setup is needed.
 * We test:
 *  1. Renders real data when the query resolves.
 *  2. Falls back to placeholder data while loading (data === undefined).
 *  3. Shows "cached" hint when the query is in error state.
 *  4. Clicking a tap button calls the toggle mutation with the correct args.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock trpc ────────────────────────────────────────────────────────────────

// We mock the entire trpc module so no QueryClient/Provider is needed.
const mockMutate = vi.fn();
const mockInvalidate = vi.fn();
const mockCancel = vi.fn();
const mockSetData = vi.fn();
const mockGetData = vi.fn();

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
        useQuery: () => mockQueryReturn,
      },
      toggle: {
        useMutation: (opts: {
          onMutate?: (args: unknown) => unknown;
          onError?: (args: unknown) => unknown;
          onSettled?: (args: unknown) => unknown;
        }) => ({
          mutate: (args: unknown) => {
            mockMutate(args);
            // Simulate onMutate being called synchronously (for optimistic tests)
            opts?.onMutate?.(args);
          },
        }),
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

import { ControlsTile } from "../ControlsTile";

// ─── setup / teardown ────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ControlsTile", () => {
  describe("renders with real data", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: {
          lamps: { on: true, count: 2, sub: "2 on · warm" },
          lights: { on: false },
          fan: { on: true, sub: "Medium" },
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
      expect(screen.getByLabelText("More controls")).toBeInTheDocument();
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

    it("shows fan sub-label when on", () => {
      render(<ControlsTile />);
      expect(screen.getByText("Medium")).toBeInTheDocument();
    });

    it("shows lamp sub-label", () => {
      render(<ControlsTile />);
      expect(screen.getByText("2 on · warm")).toBeInTheDocument();
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

    it("still renders all four cells using fallback data", () => {
      render(<ControlsTile />);
      expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
      expect(screen.getByLabelText("Lights")).toBeInTheDocument();
      expect(screen.getByLabelText("Fan")).toBeInTheDocument();
      expect(screen.getByLabelText("More controls")).toBeInTheDocument();
    });

    it("uses fallback: lamps are on by default", () => {
      render(<ControlsTile />);
      expect(screen.getByLabelText("Lamps")).toHaveAttribute("aria-pressed", "true");
    });

    it("does not show the cached badge", () => {
      render(<ControlsTile />);
      expect(screen.queryByText("cached")).not.toBeInTheDocument();
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

    it("still renders all four cells (graceful degradation)", () => {
      render(<ControlsTile />);
      expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
      expect(screen.getByLabelText("Lights")).toBeInTheDocument();
    });

    it("shows cached indicator when errored", () => {
      render(<ControlsTile />);
      expect(screen.getByText("cached")).toBeInTheDocument();
    });
  });

  describe("toggle interaction", () => {
    beforeEach(() => {
      mockQueryReturn = {
        data: {
          lamps: { on: false, count: 0, sub: "all off" },
          lights: { on: false },
          fan: { on: false, sub: "Off" },
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
          lamps: { on: true, count: 2, sub: "2 on · warm" },
          lights: { on: false },
          fan: { on: false, sub: "Off" },
        },
        isLoading: false,
        isError: false,
      };
      render(<ControlsTile />);
      fireEvent.click(screen.getByLabelText("Lamps"));
      expect(mockMutate).toHaveBeenCalledWith({ key: "lamps", on: false });
    });
  });
});
