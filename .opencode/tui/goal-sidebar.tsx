/** @jsxImportSource @opentui/solid */
// @ts-nocheck OpenCode supplies the TUI JSX runtime when it loads TUI plugins.

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  getSessionGoalStatusResult,
  getSessionGoalValidation,
} from "../plugin-lab/shared/state.js";

const RUNNING_VALIDATION_STALE_MS = 2 * 60 * 1000;

function compactError(error) {
  if (!error) {
    return "unknown error";
  }
  return error.code ? `${error.code}: ${error.message}` : String(error.message ?? error);
}

function GoalSidebar(props) {
  const [status, setStatus] = createSignal({ state: "none", goal: null, error: null });
  const [validation, setValidation] = createSignal(null);

  async function refresh(sessionID = props.sessionID) {
    setStatus(await getSessionGoalStatusResult(sessionID));
    setValidation(await getSessionGoalValidation(sessionID));
  }

  function isValidationRunning() {
    const current = validation();
    if (current?.status !== "running") {
      return false;
    }

    const startedAt = new Date(current.lastRunAt ?? current.lastValidationAt ?? 0).getTime();
    return Number.isFinite(startedAt) && Date.now() - startedAt < RUNNING_VALIDATION_STALE_MS;
  }

  createEffect(() => {
    refresh(props.sessionID);
  });

  onMount(() => {
    const timer = setInterval(refresh, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <box flexDirection="column" marginBottom={1}>
      <text bold>Goal</text>
      {status().state === "active" ? <text fg="gray">{status().goal.text}</text> : null}
      {status().state === "active" && isValidationRunning() ? (
        <text fg="gray">validating goal...</text>
      ) : null}
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
