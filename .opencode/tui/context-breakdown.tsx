/** @jsxImportSource @opentui/solid */
// @ts-nocheck OpenCode supplies the TUI JSX runtime when it loads TUI plugins.

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { buildContextBreakdown, normalizeMessages } from "./context-breakdown-core.ts";

function formatTokens(value) {
  return Math.round(value).toLocaleString("en-US");
}

function compactError(error) {
  if (!error) {
    return "unknown error";
  }
  return error.code ? `${error.code}: ${error.message}` : String(error.message ?? error);
}

function messageID(message) {
  return message?.info?.id ?? message?.id;
}

async function hydrateMessageParts(api, messages) {
  if (!api?.state?.part) {
    return messages;
  }

  const hydrated = [];
  for (const message of messages) {
    if (Array.isArray(message?.parts) && message.parts.length > 0) {
      hydrated.push(message);
      continue;
    }

    const id = messageID(message);
    if (!id) {
      hydrated.push(message);
      continue;
    }

    try {
      const parts = normalizeMessages(await api.state.part(id));
      hydrated.push({ ...message, parts });
    } catch {
      hydrated.push(message);
    }
  }

  return hydrated;
}

async function loadMessages(api, sessionID) {
  if (!sessionID || sessionID === "session_unknown") {
    return [];
  }

  if (api?.state?.session?.messages) {
    return hydrateMessageParts(api, normalizeMessages(await api.state.session.messages(sessionID)));
  }

  if (api?.client?.session?.messages) {
    try {
      return normalizeMessages(await api.client.session.messages({ path: { id: sessionID } }));
    } catch {
      return normalizeMessages(await api.client.session.messages(sessionID));
    }
  }

  return [];
}

function ContextBreakdownSidebar(props) {
  const [state, setState] = createSignal({ kind: "loading" });
  let refreshID = 0;

  async function refresh(sessionID = props.sessionID) {
    refreshID += 1;
    const currentRefreshID = refreshID;
    try {
      const messages = await loadMessages(props.api, sessionID);
      if (currentRefreshID !== refreshID) {
        return;
      }
      setState({ kind: "ready", breakdown: buildContextBreakdown(messages) });
    } catch (error) {
      if (currentRefreshID !== refreshID) {
        return;
      }
      setState({ kind: "error", error });
    }
  }

  createEffect(() => {
    refresh(props.sessionID);
  });

  onMount(() => {
    const timer = setInterval(refresh, 2000);
    onCleanup(() => clearInterval(timer));
  });

  const breakdown = () => (state().kind === "ready" ? state().breakdown : null);

  return (
    <box flexDirection="column" marginBottom={1}>
      <text bold>Context+</text>
      {state().kind === "loading" ? <text fg="gray">Loading context diagnostics...</text> : null}
      {state().kind === "error" ? (
        <text fg="red">Context error: {compactError(state().error)}</text>
      ) : null}
      {breakdown() ? (
        <box flexDirection="column">
          <text fg="gray">
            Latest exact: in {formatTokens(breakdown().exact.input)}, out{" "}
            {formatTokens(breakdown().exact.output)}, reason{" "}
            {formatTokens(breakdown().exact.reasoning)}
          </text>
          <text fg="gray">
            Cache exact: read {formatTokens(breakdown().exact.cacheRead)}, write{" "}
            {formatTokens(breakdown().exact.cacheWrite)}
          </text>
          <text fg="gray">
            Visible est: text {formatTokens(breakdown().estimates.text)}, tool{" "}
            {formatTokens(breakdown().estimates.tool)}, file{" "}
            {formatTokens(breakdown().estimates.file)}, msg{" "}
            {formatTokens(breakdown().estimates.message)}
          </text>
          <text fg="gray">
            Visible reasoning est: {formatTokens(breakdown().estimates.reasoning)}
          </text>
          {breakdown().unknown > 0 ? (
            <text fg="gray">Unknown/system/internal: {formatTokens(breakdown().unknown)}</text>
          ) : null}
          <text fg="gray">
            Assistant token fields: {breakdown().exact.withTokenFields}/
            {breakdown().exact.assistantMessages} messages
          </text>
          {!breakdown().hasExactTokens ? (
            <text fg="gray">No assistant token fields available yet</text>
          ) : null}
          <text fg="gray">OpenCode does not expose the exact system/internal split.</text>
        </box>
      ) : null}
    </box>
  );
}

function tui(api) {
  api.slots.register({
    order: 70,
    slots: {
      sidebar_content(_ctx, props) {
        return (
          <ContextBreakdownSidebar
            api={api}
            sessionID={props?.session_id ?? props?.sessionID ?? "session_unknown"}
          />
        );
      },
    },
  });
}

export default { id: "context-breakdown", tui };
