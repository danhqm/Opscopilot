import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
  process.env.JWT_ACCESS_SECRET = "test-secret-that-is-at-least-thirty-two-characters";
  process.env.INTERNAL_API_TOKEN = "test-internal-token";
});

describe("GET /api/health", () => {
  it("returns the service health envelope", async () => {
    const { createApp } = await import("../app.js");
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "healthy", service: "api-gateway", version: "0.1.0" });
  });
});
