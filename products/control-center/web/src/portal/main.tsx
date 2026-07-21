import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./portal.css";

declare global {
  interface Window {
    __ccPortalBooted?: boolean;
  }
}

// Minimal boot proving the guest-bundle pipeline (task 2.3). Screens/flow land
// in a later track-0 task; this only needs to render something so the
// legacy-fallback loader in portal.html has a real module entry to race
// against, and so the bundle-isolation test has a real graph to walk.
function PortalApp() {
  return <h1>Guest Wi-Fi</h1>;
}

const root = document.getElementById("portal-root");
if (!root) throw new Error("Missing #portal-root element");

window.__ccPortalBooted = true;

createRoot(root).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
);
