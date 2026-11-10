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
  const installation = await browser.runtime.sendMessage({type: "ensure-redirect-rules"});
  if (!allowed) {
    showStatus("attention", "Allow access", "In Safari’s extension settings, allow Golink on google.com and www.google.com.");
  } else if (installation?.ready) {
    showStatus("ready", "Ready");
  } else {
    showStatus("attention", "Unavailable", "Couldn’t prepare redirects. Reopen this popup to retry.");
  }
} catch {
  showStatus("attention", "Check settings", "Couldn’t check Safari permissions. Review Golink in Safari’s extension settings.");
}
