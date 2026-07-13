import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { initLogging } from "./lib/log/boot";
import "./styles/theme.css";
import "./styles/app-shell.css";

// Before anything else: nothing logged prior to this is recoverable, and the
// entries worth having are the ones from a boot that went wrong.
initLogging();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
