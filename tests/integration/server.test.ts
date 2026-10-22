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
