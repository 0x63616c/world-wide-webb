/** @jsxImportSource @opentui/solid */
// @ts-nocheck OpenCode supplies the TUI JSX runtime when it loads TUI plugins.

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { getSessionGoalStatusResult } from "../plugin-lab/shared/state.js";

function compactError(error) {
  if (!error) {
    return "unknown error";
  }
  return error.code ? `${error.code}: ${error.message}` : String(error.message ?? error);
}

function GoalSidebar(props) {
  const [status, setStatus] = createSignal({ state: "none", goal: null, error: null });

  async function refresh(sessionID = props.sessionID) {
    setStatus(await getSessionGoalStatusResult(sessionID));
  }

  createEffect(() => {
    refresh(props.sessionID);
  });

  onMount(() => {
    const timer = setInterval(refresh, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor={status().state === "active" ? "green" : "gray"}
    >
      <text fg="green">Goal</text>
      {status().state === "active" ? <text>{status().goal.text}</text> : null}
      {status().state === "cleared" ? <text fg="gray">Goal cleared</text> : null}
      {status().state === "none" ? <text fg="gray">No active goal</text> : null}
      {status().state === "error" ? (
        <text fg="red">State error: {compactError(status().error)}</text>
      ) : null}
    </box>
  );
}

function tui(api) {
  api.slots.register({
    order: 60,
    slots: {
      sidebar_content(_ctx, props) {
        return (
          <GoalSidebar sessionID={props?.session_id ?? props?.sessionID ?? "session_unknown"} />
        );
      },
    },
  });
}

export default { id: "goal-sidebar", tui };
