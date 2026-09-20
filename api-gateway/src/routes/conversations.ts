import { once } from "node:events";

import type { Message } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { getConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, type AuthenticatedRequest } from "../middleware/authenticate.js";
import { HttpError } from "../middleware/errors.js";
import { createRateLimiter, userKey } from "../middleware/rate-limit.js";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
}).strict();

const sendMessageSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
}).strict();

const conversationIdSchema = z.string().uuid();

function publicMessage(message: Message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    toolCalls: message.toolCallsJson,
    model: message.model,
    usage:
      message.inputTokens === null && message.outputTokens === null && message.totalTokens === null
        ? null
        : {
            inputTokens: message.inputTokens ?? 0,
            outputTokens: message.outputTokens ?? 0,
            totalTokens: message.totalTokens ?? 0,
          },
    createdAt: message.createdAt,
  };
}

export const conversationsRouter = Router();

const chatLimiter = createRateLimiter({
  bucket: "chat",
  limit: getConfig().RATE_LIMIT_CHAT_MAX,
  windowMs: 60_000,
  key: userKey,
});

conversationsRouter.post("/", authenticate, async (request, response) => {
  const input = createConversationSchema.parse(request.body);
  const conversation = await prisma.conversation.create({
    data: {
      userId: (request as AuthenticatedRequest).userId,
      title: input.title ?? "New conversation",
    },
  });
  response.status(201).json({ conversation });
});

conversationsRouter.get("/", authenticate, async (request, response) => {
  const conversations = await prisma.conversation.findMany({
    where: { userId: (request as AuthenticatedRequest).userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, role: true, createdAt: true },
      },
    },
  });

  response.json({
    conversations: conversations.map(({ _count, messages, ...conversation }) => ({
      ...conversation,
      messageCount: _count.messages,
      lastMessage: messages[0] ?? null,
    })),
  });
});

conversationsRouter.get("/:id", authenticate, async (request, response) => {
  const id = conversationIdSchema.parse(request.params.id);
  const userId = (request as AuthenticatedRequest).userId;
  const conversation = await prisma.conversation.findFirst({ where: { id, userId } });
  if (!conversation) throw new HttpError(404, "conversation_not_found", "Conversation not found.");

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  response.json({ conversation, messages: messages.reverse().map(publicMessage) });
});

conversationsRouter.post("/:id/messages/stream", authenticate, chatLimiter, async (request, response) => {
  const id = conversationIdSchema.parse(request.params.id);
  const userId = (request as AuthenticatedRequest).userId;
  const input = sendMessageSchema.parse(request.body);
  const ownedConversation = await prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!ownedConversation) throw new HttpError(404, "conversation_not_found", "Conversation not found.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const upstream = await fetch(`${getConfig().AGENT_SERVICE_URL}/agent/chat/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": getConfig().INTERNAL_API_TOKEN,
      },
      body: JSON.stringify({ user_id: userId, conversation_id: id, message: input.message }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const payload = (await upstream.json().catch(() => undefined)) as { detail?: string } | undefined;
      throw new HttpError(
        upstream.status === 404 ? 404 : 502,
        upstream.status === 404 ? "conversation_not_found" : "agent_unavailable",
        upstream.status === 404 ? "Conversation not found." : (payload?.detail ?? "The agent is unavailable."),
      );
    }
    if (!upstream.body) throw new HttpError(502, "agent_unavailable", "The agent returned an empty stream.");

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    for await (const chunk of upstream.body) {
      if (!response.write(Buffer.from(chunk))) await once(response, "drain");
    }
    response.end();
  } catch (error) {
    if (!response.headersSent) throw error;
    request.log.error({ err: error, conversationId: id }, "agent stream proxy failed");
    if (!response.writableEnded) response.end();
  } finally {
    clearTimeout(timeout);
  }
});
