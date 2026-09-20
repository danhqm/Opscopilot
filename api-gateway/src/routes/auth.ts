import bcrypt from "bcrypt";
import { Router, type Response } from "express";
import { z } from "zod";

import { getConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, type AuthenticatedRequest } from "../middleware/authenticate.js";
import { HttpError } from "../middleware/errors.js";
import { authAttemptKey, createRateLimiter } from "../middleware/rate-limit.js";
import {
  issueSession,
  publicUser,
  REFRESH_COOKIE_NAME,
  revokeSession,
  rotateSession,
} from "../services/tokens.js";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(191),
  password: z.string().min(10).max(128),
}).strict();

const credentialLimiter = createRateLimiter({
  bucket: "auth-credentials",
  limit: getConfig().RATE_LIMIT_AUTH_MAX,
  windowMs: 15 * 60_000,
  key: authAttemptKey,
});

export const authRouter = Router();

function setRefreshCookie(response: Response, token: string, expires: Date): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: "lax",
    path: "/api/auth",
    expires,
  });
}

authRouter.post("/signup", credentialLimiter, async (request, response) => {
  const input = credentialsSchema.parse(request.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new HttpError(409, "email_in_use", "An account already exists for this email.");

  const user = await prisma.user.create({
    data: { email: input.email, passwordHash: await bcrypt.hash(input.password, 12) },
  });
  const session = await issueSession(user);
  setRefreshCookie(response, session.refreshToken, session.expiresAt);
  response.status(201).json({ user: publicUser(user), accessToken: session.accessToken });
});

authRouter.post("/login", credentialLimiter, async (request, response) => {
  const input = credentialsSchema.parse(request.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
  }

  const session = await issueSession(user);
  setRefreshCookie(response, session.refreshToken, session.expiresAt);
  response.json({ user: publicUser(user), accessToken: session.accessToken });
});

authRouter.post("/refresh", async (request, response) => {
  const rawToken = request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!rawToken) throw new HttpError(401, "refresh_required", "Refresh token required.");

  const session = await rotateSession(rawToken);
  if (!session) throw new HttpError(401, "invalid_refresh", "Refresh token is invalid or expired.");

  setRefreshCookie(response, session.refreshToken, session.expiresAt);
  response.json({ user: publicUser(session.user), accessToken: session.accessToken });
});

authRouter.post("/logout", async (request, response) => {
  await revokeSession(request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);
  response.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
  response.status(204).send();
});

authRouter.get("/me", authenticate, async (request, response) => {
  const user = await prisma.user.findUnique({ where: { id: (request as AuthenticatedRequest).userId } });
  if (!user) throw new HttpError(404, "user_not_found", "User not found.");
  response.json({ user: publicUser(user) });
});
