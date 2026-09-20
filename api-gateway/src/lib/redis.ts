import { Redis } from "ioredis";

let redisClient: Redis | undefined;

export function getRedis(url = process.env.REDIS_URL ?? "redis://localhost:6379"): Redis {
  redisClient ??= new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
  return redisClient;
}
