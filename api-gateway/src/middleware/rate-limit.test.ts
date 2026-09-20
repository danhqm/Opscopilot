import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createRateLimiter, type RateLimitResult, type RateLimitStore } from "./rate-limit.js";

class FakeStore implements RateLimitStore {
  constructor(private readonly results: Array<RateLimitResult | Error>) {}

  async consume(): Promise<RateLimitResult> {
    const result = this.results.shift();
    if (!result) throw new Error("No fake result configured.");
    if (result instanceof Error) throw result;
    return result;
  }
}

function testApp(store: RateLimitStore, failureMode: "allow" | "deny" = "deny") {
  const app = express();
  app.use(
    createRateLimiter(
      { bucket: "test", limit: 2, windowMs: 60_000, key: () => "client", failureMode },
      store,
    ),
  );
  app.get("/", (_request, response) => response.json({ ok: true }));
  return app;
}

describe("Redis-backed rate limiting", () => {
  it("allows requests within quota and emits standard headers", async () => {
    const response = await request(testApp(new FakeStore([{ count: 1, resetMs: 42_500 }]))).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["ratelimit-limit"]).toBe("2");
    expect(response.headers["ratelimit-remaining"]).toBe("1");
    expect(response.headers["ratelimit-reset"]).toBe("43");
  });

  it("returns 429 with Retry-After when quota is exceeded", async () => {
    const response = await request(testApp(new FakeStore([{ count: 3, resetMs: 10_001 }]))).get("/");

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("11");
    expect(response.body.error.code).toBe("rate_limited");
  });

  it("fails closed for protected operations when Redis is unavailable", async () => {
    const response = await request(testApp(new FakeStore([new Error("offline")]))).get("/");

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("rate_limit_unavailable");
  });

  it("can fail open for the broad availability limiter", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(testApp(new FakeStore([new Error("offline")]), "allow")).get("/");
    log.mockRestore();

    expect(response.status).toBe(200);
  });
});
