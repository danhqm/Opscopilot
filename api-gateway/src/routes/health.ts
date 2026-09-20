import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";

export const healthRouter = Router();

healthRouter.get("/health", (_request, response) => {
  response.json({ status: "healthy", service: "api-gateway", version: "0.1.0" });
});

healthRouter.get("/ready", async (_request, response) => {
  const dependencies = { mysql: "down", redis: "down" };

  try {
    await prisma.$queryRaw`SELECT 1`;
    dependencies.mysql = "up";
  } catch {
    // Report all dependency states together.
  }

  try {
    const redis = getRedis();
    if (redis.status === "wait") await redis.connect();
    if ((await redis.ping()) === "PONG") dependencies.redis = "up";
  } catch {
    // Report all dependency states together.
  }

  const ready = Object.values(dependencies).every((status) => status === "up");
  response.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", dependencies });
});

