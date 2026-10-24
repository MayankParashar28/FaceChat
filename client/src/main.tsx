import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import process from "process";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// Polyfill Node.js globals for WebRTC / simple-peer
if (typeof window !== "undefined") {
  (window as any).global = window;
  if (!window.process) {
    (window as any).process = process || {};
  }
  if (!window.process.nextTick) {
    window.process.nextTick = (cb: (...args: any[]) => void, ...args: any[]) => {
      setTimeout(() => cb(...args), 0);
    };
  }
  if (!window.Buffer) {
    (window as any).Buffer = Buffer;
  }
}

// Global script error listener: if an uncaught exception prevents React from
// mounting, render a user-visible diagnostic banner rather than an empty white screen.
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const root = document.getElementById("root");
    if (root && root.children.length === 0) {
      root.innerHTML = `
        <div style="font-family:system-ui,-apple-system,sans-serif;padding:32px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#09090b;color:#f4f4f5;text-align:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;margin-bottom:16px;color:#ef4444;font-size:24px;">!</div>
          <h2 style="font-size:20px;font-weight:600;margin-bottom:8px;">Failed to initialize application</h2>
          <p style="color:#a1a1aa;max-width:440px;font-size:14px;margin-bottom:16px;line-height:1.5;">An error occurred while loading application resources:</p>
          <pre style="background:#18181b;color:#f87171;padding:12px 16px;border-radius:8px;font-size:12px;max-width:90vw;overflow:auto;text-align:left;border:1px solid rgba(239,68,68,0.2);">${event.message || event.error?.message || "Unknown initialization error"}</pre>
          <button onclick="window.location.reload()" style="margin-top:20px;padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500;font-size:14px;">Reload Page</button>
        </div>
      `;
    }
  });
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
