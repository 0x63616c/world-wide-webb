/**
 * Regression guard: LayoutEditor must never re-enable Board's paused poll.
 *
 * Board pauses its `useBoardLayout` poll with `enabled: !layoutEditOpen`
 * while the editor is mounted (see Board.layout-edit.test.tsx). LayoutEditor
 * has its OWN `useBoardLayout()` call (it reads the resolved layout to seed
 * staging), and that call is a separate query observer , if it doesn't also
 * pass `enabled: false`, opening the editor re-enables the 5s poll despite
 * Board's own query being paused, defeating the pause entirely.
 *
 * Strategy: mock `useBoardLayout` to capture the options it's called with,
 * and mock `trpc`/the layout-edit store just enough to mount the component
 * with the editor open.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let lastUseBoardLayoutOptions: { enabled?: boolean } | undefined;

vi.mock("../../../lib/useBoardLayout", () => ({
  useBoardLayout: (options?: { enabled?: boolean }) => {
    lastUseBoardLayoutOptions = options;
    return {
      status: "ready" as const,
      layout: { tiles: [] },
      revision: null,
      refetch: () => {},
    };
  },
}));

vi.mock("../../../lib/layout-edit-store", () => ({
  useLayoutEditorOpen: () => true,
  closeLayoutEditor: () => {},
}));

vi.mock("../../../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ layout: { get: { invalidate: () => {} } } }),
    layout: {
      save: {
        useMutation: () => ({
          mutate: () => {},
          isPending: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("../../../lib/tile-registry", () => ({ TILE_REGISTRY: [] }));

import { LayoutEditor } from "../LayoutEditor";

afterEach(() => {
  cleanup();
  lastUseBoardLayoutOptions = undefined;
  vi.restoreAllMocks();
});

describe("LayoutEditor , poll wiring", () => {
  it("calls useBoardLayout with enabled: false so opening the editor doesn't re-enable Board's paused poll", () => {
    render(<LayoutEditor />);
    expect(lastUseBoardLayoutOptions).toEqual({ enabled: false });
  });
});
