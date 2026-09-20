import { MessageRole, RunStatus } from "@prisma/client";
import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { authenticate, type AuthenticatedRequest } from "../middleware/authenticate.js";

export const usageRouter = Router();

usageRouter.get("/summary", authenticate, async (request, response) => {
  const userId = (request as AuthenticatedRequest).userId;

  const [messageUsage, documentGroups, workflowGroups, runGroups] = await Promise.all([
    prisma.message.aggregate({
      where: {
        conversation: { userId },
        role: MessageRole.ASSISTANT,
        totalTokens: { not: null },
      },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.document.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.workflow.groupBy({
      by: ["isActive"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.workflowRun.groupBy({
      by: ["status"],
      where: { workflow: { userId } },
      _count: { _all: true },
    }),
  ]);

  const documentCounts = new Map(documentGroups.map((group) => [group.status, group._count._all]));
  const workflowCounts = new Map(workflowGroups.map((group) => [group.isActive, group._count._all]));
  const runCounts = new Map(runGroups.map((group) => [group.status, group._count._all]));

  response.json({
    period: "all_time",
    requests: messageUsage._count._all,
    tokens: {
      input: messageUsage._sum.inputTokens ?? 0,
      output: messageUsage._sum.outputTokens ?? 0,
      total: messageUsage._sum.totalTokens ?? 0,
    },
    documents: {
      total: documentGroups.reduce((total, group) => total + group._count._all, 0),
      ready: documentCounts.get("DONE") ?? 0,
      processing: (documentCounts.get("PENDING") ?? 0) + (documentCounts.get("PROCESSING") ?? 0),
      failed: documentCounts.get("FAILED") ?? 0,
    },
    workflows: {
      total: workflowGroups.reduce((total, group) => total + group._count._all, 0),
      active: workflowCounts.get(true) ?? 0,
    },
    runs: {
      total: runGroups.reduce((total, group) => total + group._count._all, 0),
      succeeded: runCounts.get(RunStatus.SUCCEEDED) ?? 0,
      failed: runCounts.get(RunStatus.FAILED) ?? 0,
    },
  });
});
