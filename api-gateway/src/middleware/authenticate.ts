import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

import { getConfig } from "../config.js";

export type AuthenticatedRequest = Request & { userId: string };

export function authenticate(request: Request, response: Response, next: NextFunction): void {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  const token = match?.[1];

  if (!token || token.length > 4_096) {
    response.status(401).json({ error: { code: "unauthorized", message: "Access token required." } });
    return;
  }

  try {
    const config = getConfig();
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    }) as JwtPayload;
    if (payload.type !== "access" || typeof payload.sub !== "string") {
      throw new Error("Unexpected token payload");
    }
    (request as AuthenticatedRequest).userId = payload.sub;
    next();
  } catch {
    response.status(401).json({ error: { code: "invalid_token", message: "Access token is invalid or expired." } });
  }
}
