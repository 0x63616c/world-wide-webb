/**
 * Stories drive the REAL logger rather than handing the modal a fixture array:
 * the component reads from the live ring buffer via useSyncExternalStore, so the
 * only honest way to render it is to log things and let it observe them. That
 * also keeps the story exercising the same code path production uses (truncation,
 * level ranking, source binding) instead of a shape that only exists in a story.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { log } from "../lib/log/logger";
import { LogsModal } from "./LogsModal";

const meta: Meta<typeof LogsModal> = {
  title: "Components/LogsModal",
  component: LogsModal,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof LogsModal>;

/** The failure this whole feature was built to explain: a connection outage. */
function emitOutage(): void {
  const boot = log.child("boot");
  const trpc = log.child("trpc");
  const query = log.child("query");
  const conn = log.child("conn");

  boot.info("app start", { build: "a1b2c3d", viewport: "1366x1024" });
  trpc.debug("weather.current", { type: "query", path: "weather.current", ms: 38 });
  trpc.debug("climate.state", { type: "query", path: "climate.state", ms: 21 });
  trpc.error("weather.current failed", {
    type: "query",
    path: "weather.current",
    ms: 41,
    code: "INTERNAL_SERVER_ERROR",
    httpStatus: 502,
    message: "Bad Gateway",
  });
  query.warn("weather.current -> error", { failureCount: 3, error: { name: "TRPCClientError" } });
  conn.error("connection lost", {
    failing: ["weather.current", "climate.state"],
    erroringForMs: 8_004,
  });
  query.info("weather.current -> recovered");
  conn.info("connection restored");
}

function Harness() {
  useEffect(emitOutage, []);
  return <LogsModal open onClose={() => {}} />;
}

/**
 * Reading top to bottom, the log now states the causal chain the banner cannot:
 * weather.current 502'd, the query went to error, the connection flipped to lost.
 */
export const ConnectionOutage: Story = {
  render: () => <Harness />,
};

function ChattyHarness() {
  useEffect(() => {
    const trpc = log.child("trpc");
    for (let i = 0; i < 2_000; i += 1) {
      trpc.debug(`poll #${i}`, { path: "system.health", ms: 10 + (i % 30) });
    }
    log.child("tile").error("tile render error", {
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'temp')",
    });
  }, []);
  return <LogsModal open onClose={() => {}} />;
}

/**
 * 2k entries, to show the windowed list stays smooth and that the level filter is
 * the thing that makes a firehose readable (switch to "errors").
 */
export const Busy: Story = {
  render: () => <ChattyHarness />,
};
