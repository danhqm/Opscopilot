import { createHash } from "node:crypto";

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Redis } from "ioredis";

import { getRedis } from "../lib/redis.js";

const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`;

export type RateLimitResult = { count: number; resetMs: number };

export interface RateLimitStore {
  consume(key: string, windowMs: number): Promise<RateLimitResult>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Pick<Redis, "eval"> = getRedis()) {}

  async consume(key: string, windowMs: number): Promise<RateLimitResult> {
    const result = await this.redis.eval(CONSUME_SCRIPT, 1, key, windowMs);
    if (!Array.isArray(result) || result.length !== 2) throw new Error("Redis returned an invalid rate-limit result.");
    const count = Number(result[0]);
    const ttl = Number(result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) throw new Error("Redis returned non-numeric rate-limit data.");
    return { count, resetMs: Math.max(ttl, 1) };
  }
}

type RateLimiterOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
  key: (request: Request) => string;
  failureMode?: "allow" | "deny";
};

function opaqueKey(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 32);
}

export function clientKey(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

export function userKey(request: Request): string {
  const userId = (request as Request & { userId?: string }).userId;
  return userId ?? clientKey(request);
}

export function authAttemptKey(request: Request): string {
  const body = request.body as { email?: unknown } | undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "unknown";
  return `${clientKey(request)}:${email}`;
}

export function createRateLimiter(
  options: RateLimiterOptions,
  store: RateLimitStore = new RedisRateLimitStore(),
): RequestHandler {
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("Rate-limit maximum must be positive.");
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1_000) throw new Error("Rate-limit window must be at least one second.");

  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const key = `ratelimit:${options.bucket}:${opaqueKey(options.key(request))}`;
      const result = await store.consume(key, options.windowMs);
      const remaining = Math.max(options.limit - result.count, 0);
      const resetSeconds = Math.max(Math.ceil(result.resetMs / 1_000), 1);
      response.setHeader("RateLimit-Limit", String(options.limit));
      response.setHeader("RateLimit-Remaining", String(remaining));
      response.setHeader("RateLimit-Reset", String(resetSeconds));

      if (result.count > options.limit) {
        response.setHeader("Retry-After", String(resetSeconds));
        response.status(429).json({
          error: {
            code: "rate_limited",
            message: "Too many requests. Try again after the retry window.",
          },
        });
        return;
      }
      next();
    } catch (error) {
      request.log?.error({ err: error, rateLimitBucket: options.bucket }, "rate-limit store unavailable");
      if (options.failureMode === "allow") {
        next();
        return;
      }
      response.status(503).json({
        error: {
          code: "rate_limit_unavailable",
          message: "Request protection is temporarily unavailable. Please retry shortly.",
        },
      });
    }
  };
}
