import {golinkOrigin} from "./redirect.js";

const status = document.getElementById("status");
const detail = document.getElementById("status-detail");
document.getElementById("open-links").href = `${golinkOrigin}/`;

function showStatus(state, label, message = "") {
  status.dataset.state = state;
  status.textContent = label;
  detail.textContent = message;
  detail.hidden = !message;
}

try {
  const allowed = await browser.permissions.contains({origins: ["https://www.google.com/*", "https://google.com/*"]});
  const rules = await browser.declarativeNetRequest.getDynamicRules();
  if (!allowed) {
    showStatus("attention", "Allow access", "In Safari’s extension settings, allow Golink on google.com and www.google.com.");
  } else if (rules.some(rule => rule.id === 1)) {
    showStatus("ready", "Ready");
  } else {
    showStatus("attention", "Unavailable", "Turn Golink off and on in Safari’s extension settings to restore redirects.");
  }
} catch {
  showStatus("attention", "Check settings", "Couldn’t check Safari permissions. Review Golink in Safari’s extension settings.");
}
