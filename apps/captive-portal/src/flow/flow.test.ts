import { beforeEach, describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  type FlowState,
  initialFlowState,
  loadFlowState,
  type PortalEffect,
  persistFlowState,
  RESEND_COOLDOWN_S,
  reducer,
} from "./flow";

const MAC = "aa:bb:cc:dd:ee:ff";

function start(over: Partial<FlowState> = {}): FlowState {
  return { ...initialFlowState(MAC), ...over };
}

function run(state: FlowState, ...events: Parameters<typeof reducer>[1][]): FlowState {
  return events.reduce((s, e) => reducer(s, e).state, state);
}

describe("flow reducer, happy path transitions (mirror World-Wide-Webb Portal.html)", () => {
  it("landing to sending to verify to password to connecting to success", () => {
    let s = start();
    expect(s.step).toBe("landing");
    s = run(s, { type: "SUBMIT_LANDING", form: { name: "John", email: "j@x.co", agreed: true } });
    expect(s.step).toBe("sending");
    s = run(s, { type: "CODE_SENT" });
    expect(s.step).toBe("verify");
    s = run(s, { type: "VERIFY_OK" });
    expect(s.step).toBe("password");
    s = run(s, { type: "PASSWORD_OK" });
    expect(s.step).toBe("connecting");
    s = run(s, { type: "CONNECT_OK" });
    expect(s.step).toBe("success");
  });
});

describe("validation gating on landing", () => {
  it("SUBMIT_LANDING with invalid form stays on landing and sets errors", () => {
    const { state } = reducer(start(), {
      type: "SUBMIT_LANDING",
      form: { name: "", email: "nope", agreed: false },
    });
    expect(state.step).toBe("landing");
    expect(state.errors.name).toBeTruthy();
    expect(state.errors.email).toBeTruthy();
    expect(state.errors.agreed).toBeTruthy();
  });

  it("EDIT_FIELD clears that field's error only", () => {
    let s = reducer(start(), {
      type: "SUBMIT_LANDING",
      form: { name: "", email: "nope", agreed: false },
    }).state;
    s = reducer(s, { type: "EDIT_FIELD", field: "email", value: "j@x.co" }).state;
    expect(s.errors.email).toBeUndefined();
    expect(s.errors.name).toBeTruthy();
    expect(s.form.email).toBe("j@x.co");
  });
});

describe("code counters to rate limit", () => {
  it("3 wrong codes routes to ratelimited", () => {
    let s = start({ step: "verify" });
    s = run(s, { type: "VERIFY_WRONG" }, { type: "VERIFY_WRONG" });
    expect(s.step).toBe("verify");
    expect(s.codeTries).toBe(2);
    s = run(s, { type: "VERIFY_WRONG" });
    expect(s.step).toBe("ratelimited");
    expect(s.codeTries).toBe(3);
  });

  it("a wrong code sets the wrong-code error, not expired", () => {
    const { state } = reducer(start({ step: "verify" }), { type: "VERIFY_WRONG" });
    expect(state.verifyError).toMatch(/didn’t match/);
    expect(state.verifyExpired).toBe(false);
  });

  it("expired code is a distinct path from wrong code (does not increment tries)", () => {
    const { state } = reducer(start({ step: "verify", codeTries: 1 }), { type: "VERIFY_EXPIRED" });
    expect(state.step).toBe("verify");
    expect(state.verifyExpired).toBe(true);
    expect(state.verifyError).toMatch(/no longer valid/);
    expect(state.codeTries).toBe(1);
  });

  it("VERIFY_OK resets the code counter and clears errors", () => {
    const s = reducer(start({ step: "verify", codeTries: 2, verifyError: "x" }), {
      type: "VERIFY_OK",
    }).state;
    expect(s.step).toBe("password");
    expect(s.codeTries).toBe(0);
    expect(s.verifyError).toBeNull();
  });
});

describe("password counters to rate limit", () => {
  it("3 wrong passwords routes to ratelimited", () => {
    let s = start({ step: "password" });
    s = run(s, { type: "PASSWORD_WRONG" }, { type: "PASSWORD_WRONG" });
    expect(s.step).toBe("password");
    s = run(s, { type: "PASSWORD_WRONG" });
    expect(s.step).toBe("ratelimited");
    expect(s.pwTries).toBe(3);
  });

  it("PASSWORD_OK resets the pw counter and goes to connecting", () => {
    const s = reducer(start({ step: "password", pwTries: 2 }), { type: "PASSWORD_OK" }).state;
    expect(s.step).toBe("connecting");
    expect(s.pwTries).toBe(0);
  });
});

describe("connecting failure", () => {
  it("CONNECT_FAILED returns to password with a network error", () => {
    const s = reducer(start({ step: "connecting" }), { type: "CONNECT_FAILED" }).state;
    expect(s.step).toBe("password");
    expect(s.networkError).toBe(true);
  });
});

describe("back navigation resets counters AND emits a server resetAttempts effect", () => {
  it("BACK from verify to landing, resets both counters, fire-and-forget resetAttempts", () => {
    const { state, effects } = reducer(start({ step: "verify", codeTries: 2, pwTries: 1 }), {
      type: "BACK",
    });
    expect(state.step).toBe("landing");
    expect(state.codeTries).toBe(0);
    expect(state.pwTries).toBe(0);
    expect(effects).toContainEqual<PortalEffect>({ type: "resetAttempts", mac: MAC });
  });

  it("BACK from password to verify, resets counters + resetAttempts effect", () => {
    const { state, effects } = reducer(start({ step: "password", pwTries: 2 }), { type: "BACK" });
    expect(state.step).toBe("verify");
    expect(state.pwTries).toBe(0);
    expect(effects).toContainEqual<PortalEffect>({ type: "resetAttempts", mac: MAC });
  });
});

describe("resend cooldown", () => {
  it("RESEND clears errors, resets code counter, restarts the 30s cooldown, emits sendCode effect", () => {
    const { state, effects } = reducer(
      start({ step: "verify", codeTries: 2, verifyError: "x", verifyExpired: true, resendLeft: 0 }),
      { type: "RESEND" },
    );
    expect(state.codeTries).toBe(0);
    expect(state.verifyError).toBeNull();
    expect(state.verifyExpired).toBe(false);
    expect(state.resendLeft).toBe(RESEND_COOLDOWN_S);
    expect(effects.some((e) => e.type === "sendCode")).toBe(true);
  });

  it("RESEND_TICK decrements the cooldown, floored at 0", () => {
    let s = start({ step: "verify", resendLeft: 2 });
    s = reducer(s, { type: "RESEND_TICK" }).state;
    expect(s.resendLeft).toBe(1);
    s = reducer(s, { type: "RESEND_TICK" }).state;
    s = reducer(s, { type: "RESEND_TICK" }).state;
    expect(s.resendLeft).toBe(0);
  });

  it("RESEND_COOLDOWN_S is 30 (PRD)", () => {
    expect(RESEND_COOLDOWN_S).toBe(30);
  });
});

describe("double-submit lock", () => {
  it("SUBMIT_LANDING while busy is ignored", () => {
    const s = start({ busy: true });
    const { state } = reducer(s, {
      type: "SUBMIT_LANDING",
      form: { name: "John", email: "j@x.co", agreed: true },
    });
    expect(state.step).toBe("landing");
  });

  it("SUBMIT_LANDING sets busy + emits sendCode (the lock + request)", () => {
    const { state, effects } = reducer(start(), {
      type: "SUBMIT_LANDING",
      form: { name: "John", email: "j@x.co", agreed: true },
    });
    expect(state.busy).toBe(true);
    expect(effects.some((e) => e.type === "sendCode")).toBe(true);
  });

  it("CODE_SENT clears busy", () => {
    const s = reducer(start({ busy: true, step: "sending" }), { type: "CODE_SENT" }).state;
    expect(s.busy).toBe(false);
  });
});

describe("terms round-trip keeps form state", () => {
  it("OPEN_TERMS remembers the opener; CLOSE_TERMS returns to it with form intact", () => {
    const filled = start({
      step: "verify",
      form: { name: "John", email: "j@x.co", password: "", agreed: true },
    });
    const opened = reducer(filled, { type: "OPEN_TERMS" }).state;
    expect(opened.step).toBe("terms");
    expect(opened.returnTo).toBe("verify");
    const closed = reducer(opened, { type: "CLOSE_TERMS" }).state;
    expect(closed.step).toBe("verify");
    expect(closed.form.email).toBe("j@x.co");
    expect(closed.form.agreed).toBe(true);
  });

  it("OPEN_TERMS from terms does not overwrite returnTo", () => {
    const s = start({ step: "terms", returnTo: "landing" });
    expect(reducer(s, { type: "OPEN_TERMS" }).state.returnTo).toBe("landing");
  });
});

describe("RESET + recovery screens", () => {
  it("RESET clears everything back to a fresh landing", () => {
    const dirty = start({
      step: "ratelimited",
      codeTries: 3,
      pwTries: 3,
      form: { name: "J", email: "e", password: "p", agreed: true },
      verifyError: "x",
    });
    const s = reducer(dirty, { type: "RESET" }).state;
    expect(s.step).toBe("landing");
    expect(s.codeTries).toBe(0);
    expect(s.pwTries).toBe(0);
    expect(s.form).toEqual({ name: "", email: "", password: "", agreed: false });
    expect(s.verifyError).toBeNull();
    expect(s.mac).toBe(MAC);
  });

  it("RETRY from ratelimited returns to verify with counters cleared", () => {
    const s = reducer(start({ step: "ratelimited", codeTries: 3 }), { type: "RETRY" }).state;
    expect(s.step).toBe("verify");
    expect(s.codeTries).toBe(0);
    expect(s.pwTries).toBe(0);
  });
});

describe("sessionStorage persistence (step + email survive a refresh)", () => {
  beforeEach(() => sessionStorage.clear());

  it("persistFlowState then loadFlowState restores step + email (mid-flow refresh)", () => {
    const s = start({
      step: "verify",
      form: { name: "John", email: "j@x.co", password: "", agreed: true },
    });
    persistFlowState(s);
    const restored = loadFlowState(MAC);
    expect(restored?.step).toBe("verify");
    expect(restored?.form.email).toBe("j@x.co");
  });

  it("loadFlowState returns null when nothing persisted", () => {
    expect(loadFlowState(MAC)).toBeNull();
  });

  it("CODE_TTL_MS is 10 minutes (PRD)", () => {
    expect(CODE_TTL_MS).toBe(10 * 60 * 1000);
  });
});
