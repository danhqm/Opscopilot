import type { Prisma, Workflow, WorkflowRun } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import {
  getWorkflowExecutionQueue,
  removeWorkflowSchedule,
  upsertWorkflowSchedule,
} from "../lib/queues.js";
import { authenticate, type AuthenticatedRequest } from "../middleware/authenticate.js";
import { HttpError } from "../middleware/errors.js";
import { createRateLimiter, userKey } from "../middleware/rate-limit.js";
import { getConfig } from "../config.js";
import {
  nextCronRun,
  workflowDefinitionSchema,
  workflowUpdateSchema,
  type WorkflowDefinition,
} from "../services/workflow-definitions.js";


const idSchema = z.string().uuid();
const runListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const workflowRunLimiter = createRateLimiter({
  bucket: "workflow-run",
  limit: getConfig().RATE_LIMIT_ACTION_MAX,
  windowMs: 60_000,
  key: userKey,
});

type WorkflowWithLastRun = Workflow & { runs?: WorkflowRun[]; _count?: { runs: number } };

function scheduleMetadata(workflow: Workflow) {
  if (workflow.triggerType !== "CRON" || !workflow.isActive || !workflow.cronExpression) {
    return { nextRunAt: null, timezone: "UTC" };
  }
  return { nextRunAt: nextCronRun(workflow.cronExpression), timezone: "UTC" };
}

function publicRun(run: WorkflowRun) {
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    output: run.outputJson,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
  };
}

function publicWorkflow(workflow: WorkflowWithLastRun) {
  return {
    id: workflow.id,
    name: workflow.name,
    triggerType: workflow.triggerType,
    cronExpression: workflow.cronExpression,
    steps: workflow.stepsJson,
    isActive: workflow.isActive,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    ...scheduleMetadata(workflow),
    ...(workflow._count ? { runCount: workflow._count.runs } : {}),
    ...(workflow.runs ? { lastRun: workflow.runs[0] ? publicRun(workflow.runs[0]) : null } : {}),
  };
}

function storedDefinition(workflow: Workflow): WorkflowDefinition {
  return workflowDefinitionSchema.parse({
    name: workflow.name,
    triggerType: workflow.triggerType,
    cronExpression: workflow.cronExpression,
    steps: workflow.stepsJson,
    isActive: workflow.isActive,
  });
}

async function syncSchedule(workflow: Workflow): Promise<void> {
  if (workflow.triggerType === "CRON" && workflow.isActive && workflow.cronExpression) {
    await upsertWorkflowSchedule({
      id: workflow.id,
      userId: workflow.userId,
      cronExpression: workflow.cronExpression,
    });
    return;
  }
  await removeWorkflowSchedule(workflow.id);
}

export const workflowsRouter = Router();

workflowsRouter.post("/", authenticate, async (request, response) => {
  const userId = (request as AuthenticatedRequest).userId;
  const input = workflowDefinitionSchema.parse(request.body);
  const workflow = await prisma.workflow.create({
    data: {
      userId,
      name: input.name,
      triggerType: input.triggerType,
      cronExpression: input.triggerType === "CRON" ? input.cronExpression : null,
      stepsJson: input.steps as Prisma.InputJsonValue,
      isActive: input.isActive,
    },
  });

  try {
    await syncSchedule(workflow);
  } catch (error) {
    await prisma.workflow.delete({ where: { id: workflow.id } }).catch(() => undefined);
    request.log.error({ err: error, workflowId: workflow.id }, "workflow schedule registration failed");
    throw new HttpError(503, "scheduler_unavailable", "The workflow scheduler is unavailable.");
  }

  response.status(201).json({ workflow: publicWorkflow(workflow) });
});

workflowsRouter.get("/", authenticate, async (request, response) => {
  const workflows = await prisma.workflow.findMany({
    where: { userId: (request as AuthenticatedRequest).userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { runs: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  response.json({ workflows: workflows.map(publicWorkflow) });
});

workflowsRouter.get("/:id", authenticate, async (request, response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: idSchema.parse(request.params.id), userId: (request as AuthenticatedRequest).userId },
    include: {
      _count: { select: { runs: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!workflow) throw new HttpError(404, "workflow_not_found", "Workflow not found.");
  response.json({ workflow: publicWorkflow(workflow) });
});

workflowsRouter.patch("/:id", authenticate, async (request, response) => {
  const id = idSchema.parse(request.params.id);
  const userId = (request as AuthenticatedRequest).userId;
  const patch = workflowUpdateSchema.parse(request.body);
  const current = await prisma.workflow.findFirst({ where: { id, userId } });
  if (!current) throw new HttpError(404, "workflow_not_found", "Workflow not found.");

  const previous = storedDefinition(current);
  const triggerType = patch.triggerType ?? previous.triggerType;
  const cronExpression =
    patch.cronExpression !== undefined
      ? patch.cronExpression
      : patch.triggerType === "MANUAL"
        ? null
        : previous.cronExpression;
  const next = workflowDefinitionSchema.parse({
    name: patch.name ?? previous.name,
    triggerType,
    cronExpression,
    steps: patch.steps ?? previous.steps,
    isActive: patch.isActive ?? previous.isActive,
  });

  const updated = await prisma.workflow.update({
    where: { id },
    data: {
      name: next.name,
      triggerType: next.triggerType,
      cronExpression: next.triggerType === "CRON" ? next.cronExpression : null,
      stepsJson: next.steps as Prisma.InputJsonValue,
      isActive: next.isActive,
    },
  });

  try {
    await syncSchedule(updated);
  } catch (error) {
    await prisma.workflow.update({
      where: { id },
      data: {
        name: previous.name,
        triggerType: previous.triggerType,
        cronExpression: previous.triggerType === "CRON" ? previous.cronExpression : null,
        stepsJson: previous.steps as Prisma.InputJsonValue,
        isActive: previous.isActive,
      },
    });
    request.log.error({ err: error, workflowId: id }, "workflow schedule update failed");
    throw new HttpError(503, "scheduler_unavailable", "The workflow scheduler is unavailable.");
  }

  response.json({ workflow: publicWorkflow(updated) });
});

workflowsRouter.delete("/:id", authenticate, async (request, response) => {
  const id = idSchema.parse(request.params.id);
  const userId = (request as AuthenticatedRequest).userId;
  const workflow = await prisma.workflow.findFirst({ where: { id, userId }, select: { id: true } });
  if (!workflow) throw new HttpError(404, "workflow_not_found", "Workflow not found.");

  try {
    await removeWorkflowSchedule(id);
  } catch (error) {
    request.log.error({ err: error, workflowId: id }, "workflow schedule removal failed");
    throw new HttpError(503, "scheduler_unavailable", "The workflow scheduler is unavailable.");
  }
  await prisma.workflow.delete({ where: { id } });
  response.status(204).end();
});

workflowsRouter.post("/:id/runs", authenticate, workflowRunLimiter, async (request, response) => {
  const id = idSchema.parse(request.params.id);
  const userId = (request as AuthenticatedRequest).userId;
  const workflow = await prisma.workflow.findFirst({ where: { id, userId }, select: { id: true } });
  if (!workflow) throw new HttpError(404, "workflow_not_found", "Workflow not found.");

  const run = await prisma.workflowRun.create({ data: { workflowId: id } });
  try {
    await getWorkflowExecutionQueue().add(
      "execute-workflow",
      { workflowId: id, userId, trigger: "MANUAL", runId: run.id },
      { jobId: `workflow-run-${run.id}` },
    );
  } catch (error) {
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        outputJson: { error: "The workflow could not be queued." },
      },
    });
    request.log.error({ err: error, workflowId: id, runId: run.id }, "manual workflow enqueue failed");
    throw new HttpError(503, "scheduler_unavailable", "The workflow scheduler is unavailable.");
  }
  response.status(202).json({ run: publicRun(run) });
});

workflowsRouter.get("/:id/runs", authenticate, async (request, response) => {
  const id = idSchema.parse(request.params.id);
  const userId = (request as AuthenticatedRequest).userId;
  const query = runListQuerySchema.parse(request.query);
  const workflow = await prisma.workflow.findFirst({ where: { id, userId }, select: { id: true } });
  if (!workflow) throw new HttpError(404, "workflow_not_found", "Workflow not found.");

  const runs = await prisma.workflowRun.findMany({
    where: { workflowId: id },
    orderBy: { createdAt: "desc" },
    take: query.limit,
  });
  response.json({ runs: runs.map(publicRun) });
});

workflowsRouter.get("/:id/runs/:runId", authenticate, async (request, response) => {
  const id = idSchema.parse(request.params.id);
  const runId = idSchema.parse(request.params.runId);
  const userId = (request as AuthenticatedRequest).userId;
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, workflowId: id, workflow: { userId } },
  });
  if (!run) throw new HttpError(404, "workflow_run_not_found", "Workflow run not found.");
  response.json({ run: publicRun(run) });
});
