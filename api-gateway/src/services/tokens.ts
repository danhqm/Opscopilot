import { createHash, randomBytes } from "node:crypto";

import type { User } from "@prisma/client";
import jwt, { type SignOptions } from "jsonwebtoken";

import { getConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";

export const REFRESH_COOKIE_NAME = "ops_copilot_refresh";

export type PublicUser = Pick<User, "id" | "email" | "createdAt">;

export function publicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshExpiry(): Date {
  const expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + getConfig().REFRESH_TOKEN_TTL_DAYS);
  return expiry;
}

export async function issueSession(user: User): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const config = getConfig();
  const accessToken = jwt.sign(
    { type: "access", email: user.email },
    config.JWT_ACCESS_SECRET,
    {
      subject: user.id,
      expiresIn: config.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
      algorithm: "HS256",
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    },
  );
  const refreshToken = randomBytes(48).toString("base64url");
  const expiresAt = refreshExpiry();

  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt },
  });

  return { accessToken, refreshToken, expiresAt };
}

export async function rotateSession(rawToken: string): Promise<{
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
} | null> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
    return null;
  }

  await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  const session = await issueSession(existing.user);
  return { user: existing.user, ...session };
}

export async function revokeSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
