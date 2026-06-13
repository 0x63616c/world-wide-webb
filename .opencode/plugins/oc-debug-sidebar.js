export const OcDebugSidebarPlugin = async ({ client, $ }) => {
  const logPath = "/tmp/oc-debug.logs";

  const serializeArgs = (value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable]";
    }
  };

  const logToFile = async (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    await $`printf '%s\n' ${line} >> ${logPath}`;
  };

  const logHookCall = async (hookName, args) => {
    const serializedArgs = serializeArgs(args);
    await logToFile(`hook=${hookName} args=${serializedArgs}`);
    await client.app.log({
      body: {
        service: "oc-debug-sidebar",
        level: "debug",
        message: `hook called: ${hookName}`,
        hook: hookName,
        args: serializedArgs,
      },
    });
  };

  const stampSession = async (sessionData) => {
    const sessionId = sessionData?.id || sessionData?.path?.id || "unknown";
    await logHookCall("session.created", { session: sessionData });
    await logToFile(`session=${sessionId} calum was here`);
    await client.tui.showToast({
      body: {
        message: "calum was here",
        variant: "info",
      },
    });
  };

  return {
    event: async ({ event }) => {
      const eventType = event?.type || "unknown";
      await logHookCall(eventType, { eventType, event });

      if (eventType === "session.created") {
        await stampSession(event?.payload?.session || event?.payload || null);
      }
    },

    "session.created": async ({ session }) => {
      await stampSession(session);
    },

    "experimental.session.compacting": async (input, output) => {
      await logHookCall("experimental.session.compacting", { input, output });
      await logToFile("hello world!!!!");
      await client.app.log({
        body: {
          service: "oc-debug-sidebar",
          level: "info",
          message: "pre-compaction hook ran",
        },
      });
    },
  };
};
