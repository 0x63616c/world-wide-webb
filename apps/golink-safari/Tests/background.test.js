import {afterEach, expect, test} from "bun:test";
import {redirectRules} from "../Extension/redirect.js";

const originalBrowser = globalThis.browser;
const originalConsoleError = console.error;
let imports = 0;
afterEach(() => {
  globalThis.browser = originalBrowser;
  console.error = originalConsoleError;
});

function event() {
  const listeners = [];
  return {addListener: listener => listeners.push(listener), fire: (...args) => listeners.map(listener => listener(...args))};
}

async function background({rules = [], failOnce = false} = {}) {
  const errors = [];
  let active = false;
  let writes = 0;
  let resolver = "safari-web-extension://current/resolve.html";
  const installed = event();
  const startup = event();
  const message = event();
  console.error = (...args) => errors.push(args.join(" "));
  globalThis.browser = {
    runtime: {getURL: () => resolver, onInstalled: installed, onStartup: startup, onMessage: message},
    declarativeNetRequest: {
      getDynamicRules: async () => structuredClone(rules),
      updateDynamicRules: async ({removeRuleIds, addRules}) => {
        writes++;
        // Real WebKit produces this duplicate-ID rejection when lifecycle
        // updates overlap. Keep that transaction open across the event triggers.
        if (active) throw new Error("Some rules do not have unique IDs (1, 2, 3, 4, 5, 6, 7, 8).");
        active = true;
        try {
          await Bun.sleep(5);
          if (failOnce) {
            failOnce = false;
            throw new Error("Failure containing https://example.invalid/private?token=do-not-log");
          }
          rules = rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(structuredClone(addRules));
        } finally { active = false; }
      },
    },
  };
  const module = await import(`../Extension/background.js?test=${++imports}`);
  return {module, installed, startup, message, errors, writes: () => writes, rules: () => rules, changeOrigin: value => { resolver = value; }};
}

test("background bootstrap and lifecycle events share one rule installation", async () => {
  const state = await background();
  await Promise.all([...state.installed.fire(), ...state.startup.fire()]);
  expect(state.errors).toEqual([]);
  expect(state.writes()).toBe(1);
  expect(state.rules()).toEqual(redirectRules("safari-web-extension://current/resolve.html"));
});

test("matching persisted rules need no rewrite; an origin change replaces the whole ruleset", async () => {
  const state = await background({rules: redirectRules("safari-web-extension://current/resolve.html").reverse()});
  await Promise.all(state.startup.fire());
  expect(state.writes()).toBe(0);
  state.changeOrigin("safari-web-extension://updated/resolve.html");
  await Promise.all(state.installed.fire());
  expect(state.writes()).toBe(1);
  expect(state.rules()).toEqual(redirectRules("safari-web-extension://updated/resolve.html"));
});

test("a failed installation reports sanitized status and can be repaired from the popup", async () => {
  const state = await background({failOnce: true});
  await Promise.all(state.startup.fire());
  expect(state.errors).toHaveLength(1);
  expect(state.errors[0]).not.toContain("https:");
  expect(state.errors[0]).not.toContain("token");
  const [result] = await Promise.all(state.message.fire({type: "ensure-redirect-rules"}));
  expect(result).toEqual({ready: true});
  expect(state.rules()).toHaveLength(8);
});
