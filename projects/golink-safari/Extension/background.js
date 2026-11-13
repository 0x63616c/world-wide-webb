import { redirectRules } from "./redirect.js";

let pendingInstallation;

function stableRules(rules) {
  const ordered = (value) =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  return JSON.stringify(
    ordered([...rules].sort((left, right) => left.id - right.id)),
  );
}

async function installRules() {
  try {
    const desired = redirectRules(browser.runtime.getURL("resolve.html"));
    const installed = await browser.declarativeNetRequest.getDynamicRules();
    if (stableRules(installed) !== stableRules(desired)) {
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: installed.map((rule) => rule.id),
        addRules: desired,
      });
    }
    return { ready: true };
  } catch (error) {
    // Classify the API failure without recording its message, URLs or queries.
    const reason = /unique IDs/i.test(error?.message ?? "")
      ? "rule-conflict"
      : /regular expression|regexFilter/i.test(error?.message ?? "")
        ? "unsupported-rule"
        : /permission|access/i.test(error?.message ?? "")
          ? "permission"
          : "unavailable";
    console.error(`Golink redirect setup failed (${reason}).`);
    return { ready: false, reason };
  }
}

export function ensureRedirectRules() {
  // Safari wakes the background page before delivering lifecycle events. Share
  // the entire read/update operation so bootstrap and those events cannot race.
  pendingInstallation ??= installRules().finally(() => {
    pendingInstallation = undefined;
  });
  return pendingInstallation;
}

browser.runtime.onInstalled.addListener(ensureRedirectRules);
browser.runtime.onStartup.addListener(ensureRedirectRules);
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "ensure-redirect-rules") return ensureRedirectRules();
});
// Reconcile persisted rules when Safari changes the extension origin; a normal
// background wake leaves matching rules untouched.
void ensureRedirectRules();
