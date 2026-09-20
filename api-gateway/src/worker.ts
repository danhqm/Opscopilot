import type { Prisma } from "@prisma/client";
import { Worker, type Job } from "bullmq";

import { getConfig } from "./config.js";
import { prisma } from "./lib/prisma.js";
import {
  getWorkflowExecutionQueue,
  upsertWorkflowSchedule,
  workflowSchedulerId,
  type WorkflowJobData,
} from "./lib/queues.js";
import { logger } from "./logger.js";


const config = getConfig();
const redisUrl = new URL(config.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Unknown workflow execution error.";
}

async function reconcileWorkflowSchedules(): Promise<void> {
  const queue = getWorkflowExecutionQueue();
  const workflows = await prisma.workflow.findMany({
    where: { triggerType: "CRON", isActive: true, cronExpression: { not: null } },
    select: { id: true, userId: true, cronExpression: true },
  });
  const desired = new Set(workflows.map((workflow) => workflowSchedulerId(workflow.id)));
  const existing = await queue.getJobSchedulers(0, -1, true);
  await Promise.all(
    existing
      .filter((scheduler) => scheduler.key.startsWith("workflow:") && !desired.has(scheduler.key))
      .map((scheduler) => queue.removeJobScheduler(scheduler.key)),
  );
  await Promise.all(
    workflows.map((workflow) =>
      upsertWorkflowSchedule({
        id: workflow.id,
        userId: workflow.userId,
        cronExpression: workflow.cronExpression!,
      }),
    ),
  );
  logger.info({ scheduleCount: workflows.length }, "workflow schedules reconciled");
}

async function executeWorkflow(job: Job<WorkflowJobData>): Promise<Record<string, unknown>> {
  const workflow = await prisma.workflow.findFirst({
    where: { id: job.data.workflowId, userId: job.data.userId },
  });
  if (!workflow) {
    logger.warn({ jobId: job.id, workflowId: job.data.workflowId }, "workflow no longer exists; skipping job");
    return { status: "skipped", reason: "workflow_not_found" };
  }
  if (job.data.trigger === "CRON" && !workflow.isActive) {
    logger.info({ jobId: job.id, workflowId: workflow.id }, "inactive scheduled workflow skipped");
    return { status: "skipped", reason: "workflow_inactive" };
  }

  let runId = job.data.runId;
  if (!runId) {
    const created = await prisma.workflowRun.create({ data: { workflowId: workflow.id } });
    runId = created.id;
    await job.updateData({ ...job.data, runId });
  }
  const ownedRun = await prisma.workflowRun.findFirst({
    where: { id: runId, workflowId: workflow.id },
    select: { id: true },
  });
  if (!ownedRun) throw new Error("Workflow run does not belong to the queued workflow.");

  await prisma.workflowRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date(), finishedAt: null },
  });
  await job.updateProgress({ runId, status: "RUNNING" });

  try {
    const upstream = await fetch(`${config.AGENT_SERVICE_URL}/agent/workflows/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": config.INTERNAL_API_TOKEN,
      },
      body: JSON.stringify({
        user_id: workflow.userId,
        workflow_id: workflow.id,
        run_id: runId,
        steps: workflow.stepsJson,
      }),
      signal: AbortSignal.timeout(config.WORKFLOW_EXECUTION_TIMEOUT_MS),
    });
    const body = (await upstream.json().catch(() => undefined)) as
      | { status?: string; steps?: unknown[]; error?: string; usage?: unknown }
      | undefined;
    if (!upstream.ok || !body) {
      throw new Error(`Agent workflow execution failed with HTTP ${upstream.status}.`);
    }

    const succeeded = body.status === "SUCCEEDED";
    const output = {
      trigger: job.data.trigger,
      steps: body.steps ?? [],
      usage: body.usage ?? null,
      error: body.error ?? null,
    };
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: succeeded ? "SUCCEEDED" : "FAILED",
        outputJson: jsonValue(output),
        finishedAt: new Date(),
      },
    });
    await job.updateProgress({ runId, status: succeeded ? "SUCCEEDED" : "FAILED" });
    if (!succeeded) {
      logger.warn({ jobId: job.id, workflowId: workflow.id, runId }, "workflow completed with a failed step");
    }
    return { status: succeeded ? "succeeded" : "failed", runId };
  } catch (error) {
    const message = errorMessage(error);
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        outputJson: { trigger: job.data.trigger, error: message },
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}

await reconcileWorkflowSchedules();

const workflowWorker = new Worker<WorkflowJobData>("workflow-execution", executeWorkflow, {
  connection,
  concurrency: 2,
  lockDuration: config.WORKFLOW_EXECUTION_TIMEOUT_MS + 30_000,
});

const ingestionWorker = new Worker<{ documentId: string; userId: string }>(
  "document-ingestion",
  async (job) => {
    const result = await fetch(`${config.AGENT_SERVICE_URL}/agent/ingestion/process`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": config.INTERNAL_API_TOKEN },
      body: JSON.stringify({ document_id: job.data.documentId, user_id: job.data.userId }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!result.ok) {
      const body = await result.text();
      throw new Error(`Agent ingestion failed with ${result.status}: ${body.slice(0, 500)}`);
    }
    return result.json();
  },
  { connection, concurrency: 2 },
);

workflowWorker.on("ready", () => logger.info("workflow worker ready"));
workflowWorker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, workflowId: job.data.workflowId, runId: job.data.runId, result }, "workflow job completed");
});
workflowWorker.on("failed", (job, error) => {
  logger.error({ err: error, jobId: job?.id, workflowId: job?.data.workflowId, runId: job?.data.runId }, "workflow job failed");
});
ingestionWorker.on("ready", () => logger.info("document ingestion worker ready"));
ingestionWorker.on("completed", (job) => logger.info({ jobId: job.id }, "document ingestion completed"));
ingestionWorker.on("failed", (job, error) => {
  logger.error({ err: error, jobId: job?.id, attemptsMade: job?.attemptsMade }, "document ingestion failed");
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void prisma.document.updateMany({
      where: { id: job.data.documentId, userId: job.data.userId, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "FAILED", failureReason: error.message.slice(0, 2_000) },
    });
  }
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down workers");
  await Promise.all([workflowWorker.close(), ingestionWorker.close(), getWorkflowExecutionQueue().close()]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
