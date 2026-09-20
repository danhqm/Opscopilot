import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "./errors.js";

function testApp(limit = "1kb") {
  const app = express();
  app.use(express.json({ limit }));
  app.post("/payload", (_request, response) => response.status(204).end());
  app.use(errorHandler);
  return app;
}

describe("JSON body errors", () => {
  it("returns a stable 400 response for malformed JSON", async () => {
    const response = await request(testApp()).post("/payload").set("content-type", "application/json").send('{"broken"');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_json");
  });

  it("returns 413 when the body exceeds its configured limit", async () => {
    const response = await request(testApp("10b"))
      .post("/payload")
      .set("content-type", "application/json")
      .send(JSON.stringify({ value: "too large" }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("payload_too_large");
  });
});
