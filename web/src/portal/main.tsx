import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./portal.css";

declare global {
  interface Window {
    __ccPortalBooted?: boolean;
  }
}

const root = document.getElementById("portal-root");
if (!root) throw new Error("Missing #portal-root element");

window.__ccPortalBooted = true;

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
