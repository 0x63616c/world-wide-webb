import {
  clearSessionGoal,
  clearSessionGoalValidation,
  getSessionGoalStatus,
  setSessionGoal,
} from "../plugin-lab/shared/state.js";

function extractSessionID(input) {
  return (
    input?.sessionID ??
    input?.session_id ??
    input?.session?.id ??
    input?.context?.sessionID ??
    input?.context?.session_id ??
    "session_unknown"
  );
}

function extractCommandText(input) {
  const raw =
    input?.arguments ??
    input?.args?.arguments ??
    input?.text ??
    input?.message ??
    input?.input ??
    input?.args?.text ??
    "";
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function goalArgument(commandText) {
  return commandText.replace(/^\/goal(?:\s+|$)/, "").trim();
}

function isGoalCommand(input, commandText) {
  return input?.command === "goal" || /^\/goal(?:\s|$)/.test(commandText);
}

function setCommandOutput(output, text) {
  if (!output || typeof output !== "object") {
    return;
  }

  if (Array.isArray(output.parts)) {
    output.parts.splice(0, output.parts.length, { type: "text", text });
  } else {
    output.parts = [{ type: "text", text }];
  }
  output.message = text;
  output.content = text;
  output.handled = true;
  output.preventDefault = true;
}

function formatStatus(status) {
  if (status.state === "active") {
    return `Active goal:\n${status.goal.text}`;
  }
  if (status.state === "cleared") {
    return status.goal.text ? `Goal cleared. Last goal:\n${status.goal.text}` : "Goal cleared.";
  }
  return "No active goal.";
}

async function server() {
  return {
    "command.execute.before": async (input, output) => {
      const commandText = extractCommandText(input);
      if (!isGoalCommand(input, commandText)) {
        return;
      }

      const sessionID = extractSessionID(input);
      const arg = goalArgument(commandText);

      if (arg === "status") {
        setCommandOutput(output, formatStatus(await getSessionGoalStatus(sessionID)));
        return;
      }

      if (arg === "clear") {
        await clearSessionGoal(sessionID);
        await clearSessionGoalValidation(sessionID);
        setCommandOutput(output, "Goal cleared.");
        return;
      }

      if (arg.length === 0) {
        setCommandOutput(output, "Usage: /goal <text>, /goal status, or /goal clear.");
        return;
      }

      await setSessionGoal(sessionID, arg);
      setCommandOutput(output, `Goal set:\n${arg}`);
    },
  };
}

export default { id: "goal-command", server };
