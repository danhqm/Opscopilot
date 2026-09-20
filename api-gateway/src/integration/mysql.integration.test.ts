import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const integrationDescribe = process.env.RUN_MYSQL_INTEGRATION === "true" ? describe : describe.skip;
const prisma = new PrismaClient();

integrationDescribe("MySQL persistence", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists an owned conversation and enforces cascade deletion", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `phase7-${suffix}@example.invalid`,
        passwordHash: "integration-test-only",
        conversations: {
          create: {
            title: "Phase 7 integration",
            messages: { create: { role: "USER", content: "Verify the real MySQL path." } },
          },
        },
      },
      include: { conversations: { include: { messages: true } } },
    });

    const conversation = user.conversations[0];
    expect(conversation?.userId).toBe(user.id);
    expect(conversation?.messages[0]?.content).toBe("Verify the real MySQL path.");

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.conversation.findUnique({ where: { id: conversation!.id } })).toBeNull();
  });
});
