import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "api-gateway" },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']", "password", "token"],
    censor: "[redacted]",
  },
});
