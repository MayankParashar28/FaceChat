import { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { type Server } from "http";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export { log, serveStatic } from "./static";

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  let viteConfig;
  try {
    viteConfig = (await import("../vite.config")).default;
    console.log("viteConfig loaded successfully:", viteConfig);
  } catch (error) {
    console.error("Failed to load viteConfig:", error);
    throw error;
  }
  // Vite's own logger, deliberately. The scaffold this started from wrapped it
  // with a logger whose `error` called process.exit(1), which meant any message
  // Vite logged at error level killed the whole process — and a JSX typo in a
  // client file is logged at error level. One bad keystroke took down the API,
  // socket.io and the cron jobs with it, and left the browser unable to connect
  // until someone restarted by hand.
  //
  // A compile error belongs to one module, not to the server. Logged and left
  // alone, Vite serves its own error overlay and recovers on the next save.
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    if (url.startsWith("/api")) {
      return res.status(404).json({ error: `API endpoint not found: ${req.method} ${url}` });
    }

    try {
      const clientTemplate = path.resolve(__dirname, "..", "client", "index.html");

      // always reload the index.html file from disk in case it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${randomUUID()}"`);
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
