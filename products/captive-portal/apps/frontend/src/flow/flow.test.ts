import { describe, expect, it } from "vitest";
import { type FlowState, initialFlowState, type PortalEffect, reducer } from "./flow";

const MAC = "aa:bb:cc:dd:ee:ff";

function start(over: Partial<FlowState> = {}): FlowState {
  return { ...initialFlowState(MAC), ...over };
}

function run(state: FlowState, ...events: Parameters<typeof reducer>[1][]): FlowState {
  return events.reduce((s, e) => reducer(s, e).state, state);
}

describe("flow reducer, password-only happy path (www-p9hx)", () => {
  it("starts on the password screen", () => {
    expect(start().step).toBe("password");
  });

  it("password (agreed) → connecting → success", () => {
    let s = start({ form: { password: "", agreed: true } });
    const { state, effects } = reducer(s, { type: "PASSWORD_SUBMIT", password: "guest-passw0rd" });
    s = state;
    expect(s.step).toBe("password"); // stays until checkPassword resolves
    expect(s.busy).toBe(true);
    expect(effects).toContainEqual<PortalEffect>({
      type: "checkPassword",
      password: "guest-passw0rd",
      mac: MAC,
    });
    s = run(s, { type: "PASSWORD_OK" });
    expect(s.step).toBe("connecting");
    s = run(s, { type: "CONNECT_OK" });
    expect(s.step).toBe("success");
  });
});

describe("terms gate", () => {
  it("PASSWORD_SUBMIT is ignored until the guest agrees to the terms", () => {
    const { state, effects } = reducer(start({ form: { password: "", agreed: false } }), {
      type: "PASSWORD_SUBMIT",
      password: "guest-passw0rd",
    });
    expect(state.step).toBe("password");
    expect(state.busy).toBe(false);
    expect(effects).toEqual([]);
  });

  it("EDIT_FIELD toggles agreed and clears stale errors", () => {
    let s = reducer(start(), { type: "PASSWORD_WRONG" }).state;
    expect(s.passwordError).toBeTruthy();
    s = reducer(s, { type: "EDIT_FIELD", field: "agreed", value: true }).state;
    expect(s.form.agreed).toBe(true);
    expect(s.passwordError).toBeNull();
  });
});

describe("wrong password is inline only (no client lockout, server enforces global limit)", () => {
  it("PASSWORD_WRONG sets the inline hint and stays on the password screen", () => {
    let s = start({ form: { password: "", agreed: true } });
    s = run(s, { type: "PASSWORD_WRONG" }, { type: "PASSWORD_WRONG" }, { type: "PASSWORD_WRONG" });
    expect(s.step).toBe("password"); // never self-locks
    expect(s.passwordError).toMatch(/isn’t right/);
  });

  it("server RATE_LIMITED → SHOW_RATELIMIT routes to the ratelimited screen", () => {
    const s = reducer(start(), { type: "SHOW_RATELIMIT" }).state;
    expect(s.step).toBe("ratelimited");
  });

  it("PASSWORD_OK clears busy and goes to connecting", () => {
    const s = reducer(start({ busy: true }), { type: "PASSWORD_OK" }).state;
    expect(s.step).toBe("connecting");
    expect(s.busy).toBe(false);
  });
});

describe("double-submit lock", () => {
  it("PASSWORD_SUBMIT while busy is ignored", () => {
    const { state, effects } = reducer(start({ busy: true, form: { password: "", agreed: true } }), {
      type: "PASSWORD_SUBMIT",
      password: "x",
    });
    expect(effects).toEqual([]);
    expect(state.busy).toBe(true);
  });
});

describe("connecting failure", () => {
  it("CONNECT_FAILED returns to password with a network error", () => {
    const s = reducer(start({ step: "connecting" }), { type: "CONNECT_FAILED" }).state;
    expect(s.step).toBe("password");
    expect(s.networkError).toBe(true);
  });
});

describe("terms round-trip keeps form state", () => {
  it("OPEN_TERMS remembers the opener; CLOSE_TERMS returns with form intact", () => {
    const filled = start({ form: { password: "secret", agreed: true } });
    const opened = reducer(filled, { type: "OPEN_TERMS" }).state;
    expect(opened.step).toBe("terms");
    expect(opened.returnTo).toBe("password");
    const closed = reducer(opened, { type: "CLOSE_TERMS" }).state;
    expect(closed.step).toBe("password");
    expect(closed.form.agreed).toBe(true);
  });

  it("OPEN_TERMS from terms does not overwrite returnTo", () => {
    const s = start({ step: "terms", returnTo: "password" });
    expect(reducer(s, { type: "OPEN_TERMS" }).state.returnTo).toBe("password");
  });
});

describe("RESET + recovery screens", () => {
  it("RESET clears everything back to a fresh password screen", () => {
    const dirty = start({
      step: "ratelimited",
      form: { password: "p", agreed: true },
      passwordError: "x",
    });
    const s = reducer(dirty, { type: "RESET" }).state;
    expect(s.step).toBe("password");
    expect(s.form).toEqual({ password: "", agreed: false });
    expect(s.passwordError).toBeNull();
    expect(s.mac).toBe(MAC);
  });

  it("RETRY from ratelimited returns to the password screen, errors cleared", () => {
    const s = reducer(start({ step: "ratelimited", passwordError: "x" }), { type: "RETRY" }).state;
    expect(s.step).toBe("password");
    expect(s.passwordError).toBeNull();
  });

  it("SHOW_ALREADY_CONNECTED / SHOW_SESSION_EXPIRED route to their screens", () => {
    expect(reducer(start(), { type: "SHOW_ALREADY_CONNECTED" }).state.step).toBe("already");
    expect(reducer(start(), { type: "SHOW_SESSION_EXPIRED" }).state.step).toBe("sessionexpired");
  });
});
