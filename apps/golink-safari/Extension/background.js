import {redirectRules} from "./redirect.js";

async function installRule() {
  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1, 2, 3, 4, 5, 6, 7, 8],
      addRules: redirectRules(browser.runtime.getURL("resolve.html")),
    });
  } catch {
    // Report only a fixed diagnostic, never URLs or search terms.
    console.error("Golink could not install its Safari redirect rule.");
  }
}

browser.runtime.onInstalled.addListener(installRule);
browser.runtime.onStartup.addListener(installRule);
// Recreate the rule if Safari assigns a new extension origin after an update.
void installRule();
