import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { io as ioClient, type Socket } from "socket.io-client";
import request from "supertest";
import { registerRoutes } from "../../server/routes";

let server: Server;
let baseURL: string;

beforeAll(async () => {
  const app = express();
  server = await registerRoutes(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseURL = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("API: GET /api/health", () => {
  it("responds with a database health status", async () => {
    const res = await request(server).get("/api/health");
    // 200 when Mongo is reachable, 503 otherwise — both are valid "it responded".
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
  });
});

describe("API: POST /api/conversations/:id/ghost/destroy", () => {
  it("is registered and refuses an unauthenticated caller", async () => {
    const res = await request(server)
      .post("/api/conversations/507f1f77bcf86cd799439011/ghost/destroy")
      .send();

    // Not 404: a 404 here would mean the route was never mounted, and the
    // thing being checked is that ending a chat sits behind authentication.
    expect(res.status).toBe(401);
  });

  it("refuses an unauthenticated caller before looking at the id", async () => {
    const res = await request(server)
      .post("/api/conversations/not-an-objectid/ghost/destroy")
      .send();

    // The id is rubbish, but that must not be what comes back — replying 400
    // would tell an anonymous caller which ids are well formed.
    expect(res.status).toBe(401);
  });
});

describe("API: DELETE /api/invites/:code", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = await request(server).delete("/api/invites/deadbeef").send();

    // Anyone could otherwise withdraw a link just by guessing its code.
    expect(res.status).toBe(401);
  });

  it("refuses before judging whether the code is well formed", async () => {
    const res = await request(server).delete("/api/invites/not-a-code").send();

    expect(res.status).toBe(401);
  });

  it("leaves the public preview readable", async () => {
    // GET on the same path is deliberately public, and adding DELETE must not
    // have put the preview behind authentication.
    const res = await request(server).get("/api/invites/deadbeef");

    expect(res.status).not.toBe(401);
  });
});

describe("API: GET /api/avatars/:seed", () => {
  /**
   * supertest has no parser for image/svg+xml, so it leaves the body as a
   * buffer and `res.text` undefined. `.buffer()` makes that explicit.
   */
  const svg = (path: string) =>
    request(server)
      .get(path)
      .buffer()
      .then((res) => ({ res, body: Buffer.from(res.body).toString("utf8") }));

  it("draws the avatar here instead of at api.dicebear.com", async () => {
    const { res, body } = await svg("/api/avatars/mayank.svg");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(body.startsWith("<svg")).toBe(true);
  });

  it("stays public, because the invite preview renders before sign-in", async () => {
    const res = await request(server).get("/api/avatars/someone.svg");

    expect(res.status).not.toBe(401);
  });

  it("tells the browser to keep it forever, since a seed never changes face", async () => {
    const res = await request(server).get("/api/avatars/mayank.svg");

    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("draws the same face for the same seed", async () => {
    const [a, b] = await Promise.all([
      svg("/api/avatars/repeat.svg"),
      svg("/api/avatars/repeat.svg"),
    ]);

    expect(a.body).toBe(b.body);
    expect(a.body.length).toBeGreaterThan(0);
  });

  it("refuses a seed longer than any username or uid", async () => {
    const res = await request(server).get(`/api/avatars/${"a".repeat(70)}.svg`);

    expect(res.status).toBe(400);
  });

  it("never writes the seed into the picture", async () => {
    // The seed only drives the generator's PRNG. Were it echoed, a crafted
    // seed would put attacker markup inside a same-origin document.
    const { res, body } = await svg(
      `/api/avatars/${encodeURIComponent('"><script>alert(1)</script>')}.svg`
    );

    expect(res.status).toBe(200);
    expect(body).not.toContain("alert(1)");
  });
});

describe("Socket.io", () => {
  it("accepts a client connection", async () => {
    const client: Socket = ioClient(baseURL, {
      transports: ["websocket"],
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket connect timeout")), 8000);
        client.on("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        client.on("connect_error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      expect(client.connected).toBe(true);
    } finally {
      client.disconnect();
    }
  });
});
