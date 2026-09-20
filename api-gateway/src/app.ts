import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { getConfig } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/errors.js";
import { clientKey, createRateLimiter } from "./middleware/rate-limit.js";
import { authRouter } from "./routes/auth.js";
import { conversationsRouter } from "./routes/conversations.js";
import { documentsRouter } from "./routes/documents.js";
import { healthRouter } from "./routes/health.js";
import { usageRouter } from "./routes/usage.js";
import { workflowsRouter } from "./routes/workflows.js";

export function createApp() {
  const app = express();
  const config = getConfig();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/api", healthRouter);
  app.use(
    "/api",
    createRateLimiter({
      bucket: "global",
      limit: config.RATE_LIMIT_GLOBAL_MAX,
      windowMs: 60_000,
      key: clientKey,
      failureMode: "allow",
    }),
  );
  app.use("/api/auth", authRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/usage", usageRouter);
  app.use("/api/workflows", workflowsRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "not_found", message: "Route not found." } });
  });
  app.use(errorHandler);

  return app;
}
