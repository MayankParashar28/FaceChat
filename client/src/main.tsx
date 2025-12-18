import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import process from "process";
import App from "./App";
import "./index.css";

// Polyfill Node.js globals for simple-peer
window.global = window;
window.process = process;
window.Buffer = Buffer;

if (typeof window.process === 'undefined') {
  window.process = {} as any;
}
if (typeof window.process.nextTick === 'undefined') {
  window.process.nextTick = (cb: (...args: any[]) => void, ...args: any[]) => {
    setTimeout(() => cb(...args), 0);
  };
}

createRoot(document.getElementById("root")!).render(
  <App />
);
