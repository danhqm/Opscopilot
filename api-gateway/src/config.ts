import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  AGENT_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  WORKFLOW_EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(900_000).default(300_000),
  INTERNAL_API_TOKEN: z.string().min(16),
  UPLOAD_DIR: z.string().min(1).default("uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  JWT_ISSUER: z.string().min(1).default("ops-copilot-api"),
  JWT_AUDIENCE: z.string().min(1).default("ops-copilot-web"),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(10).max(10_000).default(240),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(2).max(1_000).default(10),
  RATE_LIMIT_CHAT_MAX: z.coerce.number().int().min(1).max(1_000).default(30),
  RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().min(1).max(1_000).default(20),
  RATE_LIMIT_ACTION_MAX: z.coerce.number().int().min(1).max(1_000).default(30),
});

export type AppConfig = z.infer<typeof environmentSchema>;

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= environmentSchema.parse(process.env);
  return cachedConfig;
}
