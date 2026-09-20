import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

const config = getConfig();
const server = createApp().listen(config.API_PORT, "0.0.0.0", () => {
  logger.info({ port: config.API_PORT }, "API gateway listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down API gateway");
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "graceful shutdown failed");
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

