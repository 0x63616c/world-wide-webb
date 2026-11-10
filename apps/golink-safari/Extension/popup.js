const status = document.getElementById("status");
try {
  const allowed = await browser.permissions.contains({origins: ["https://www.google.com/*", "https://google.com/*"]});
  const rules = await browser.declarativeNetRequest.getDynamicRules();
  status.textContent = !allowed ? "In Safari’s extension settings, allow Golink on google.com and www.google.com."
    : rules.some(rule => rule.id === 1) ? "Ready for go links."
    : "The redirect rule is unavailable. Turn Golink off and on in Safari’s extension settings.";
} catch {
  status.textContent = "Open Safari’s extension settings and allow Golink on google.com and www.google.com.";
}
