const DEFAULT_OPTIONS = {
  enabled: true,
  mode: "native",
  sound: "done",
  volume: 0.5,
  debounceMs: 4000,
  afplayPath: "/System/Library/Sounds/Glass.aiff",
  afplayBinary: "/usr/bin/afplay",
};

function normalizeOptions(options = {}) {
  const enabled = options.enabled ?? DEFAULT_OPTIONS.enabled;
  const mode = options.mode ?? DEFAULT_OPTIONS.mode;

  return {
    enabled: enabled !== false,
    mode: mode === "afplay" || mode === "fallback" ? mode : "native",
    sound:
      typeof options.sound === "string" && options.sound ? options.sound : DEFAULT_OPTIONS.sound,
    volume: typeof options.volume === "number" ? options.volume : DEFAULT_OPTIONS.volume,
    debounceMs:
      typeof options.debounceMs === "number" ? options.debounceMs : DEFAULT_OPTIONS.debounceMs,
    afplayPath:
      typeof options.afplayPath === "string" && options.afplayPath
        ? options.afplayPath
        : DEFAULT_OPTIONS.afplayPath,
    afplayBinary:
      typeof options.afplayBinary === "string" && options.afplayBinary
        ? options.afplayBinary
        : DEFAULT_OPTIONS.afplayBinary,
  };
}

function eventIsIdle(event) {
  if (!event) {
    return true;
  }

  return (
    event.status === "idle" ||
    event.properties?.status?.type === "idle" ||
    event.type === "session.idle" ||
    event.event === "session.idle" ||
    event.name === "session.idle"
  );
}

function idleEventKey(event) {
  const sessionID =
    event?.properties?.sessionID ?? event?.sessionID ?? event?.session_id ?? event?.session?.id;
  const messageID =
    event?.properties?.messageID ??
    event?.properties?.assistantMessageID ??
    event?.messageID ??
    event?.message_id ??
    event?.message?.id;

  if (sessionID && messageID) {
    return `${sessionID}:${messageID}`;
  }

  return null;
}

function notifyNative(api, options) {
  const notify = api.attention?.notify;

  if (typeof notify !== "function") {
    return false;
  }

  notify({
    message: "A response is ready",
    sound: { name: options.sound, volume: options.volume, when: "always" },
    notification: { when: "blurred" },
  });

  return true;
}

function notifyAfplay(options) {
  if (typeof Bun === "undefined" || typeof Bun.spawn !== "function") {
    return false;
  }

  for (let index = 0; index < 2; index += 1) {
    Bun.spawn([options.afplayBinary, "-v", String(options.volume), options.afplayPath], {
      stdout: "ignore",
      stderr: "ignore",
    });
  }

  return true;
}

function emitAttention(api, options) {
  if (options.mode === "native" && notifyNative(api, options)) {
    return;
  }

  if (options.mode === "fallback" && notifyNative(api, options)) {
    return;
  }

  if (options.mode === "afplay" || options.mode === "fallback") {
    notifyAfplay(options);
  }
}

function registerIdleListener(api, name, handler) {
  const on = api.event?.on ?? api.events?.on ?? api.on;

  if (typeof on !== "function") {
    return;
  }

  on(name, handler);
}

function tui(api, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);

  if (!options.enabled) {
    return;
  }

  let lastNotifiedAt = 0;
  let lastIdleKey = null;

  function handleIdle(event) {
    if (!eventIsIdle(event)) {
      return;
    }

    const now = Date.now();
    const nextIdleKey = idleEventKey(event);

    if (nextIdleKey && nextIdleKey === lastIdleKey) {
      return;
    }

    if (!nextIdleKey && now - lastNotifiedAt < options.debounceMs) {
      return;
    }

    lastIdleKey = nextIdleKey;
    lastNotifiedAt = now;
    emitAttention(api, options);
  }

  registerIdleListener(api, "session.idle", handleIdle);
  registerIdleListener(api, "session.status", handleIdle);
}

export { eventIsIdle, idleEventKey, normalizeOptions };
export default { id: "reply-attention", tui };
