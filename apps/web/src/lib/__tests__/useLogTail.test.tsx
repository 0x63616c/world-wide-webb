import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { log } from "../log/logger";
import { useLogTail } from "../log/useLogTail";

/**
 * The one seam every live-tail view shares. Both LogsView and the Activity
 * page's wake diagnostic used to hand-roll `useSyncExternalStore(subscribe,
 * getTail)`; this pins the shared hook's two guarantees , current snapshot on
 * mount, and a re-render on the next write.
 */
function TailProbe() {
  const tail = useLogTail();
  return <div data-testid="tail">{tail.map((e) => e.msg).join("|")}</div>;
}

describe("useLogTail", () => {
  it("renders the tail present at mount", () => {
    log.info("before-mount");
    render(<TailProbe />);
    expect(screen.getByTestId("tail").textContent).toContain("before-mount");
  });

  it("re-renders on the next write", () => {
    render(<TailProbe />);
    expect(screen.getByTestId("tail").textContent).not.toContain("after-mount");
    act(() => {
      log.info("after-mount");
    });
    expect(screen.getByTestId("tail").textContent).toContain("after-mount");
  });
});
