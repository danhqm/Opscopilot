import { Queue } from "bullmq";

import { getConfig } from "../config.js";

function redisConnection() {
  const redisUrl = new URL(getConfig().REDIS_URL);
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
  };
}

let documentIngestionQueue: Queue | undefined;
let workflowExecutionQueue: Queue<WorkflowJobData> | undefined;

export type WorkflowJobData = {
  workflowId: string;
  userId: string;
  trigger: "MANUAL" | "CRON";
  runId?: string;
};

export const workflowSchedulerId = (workflowId: string) => `workflow:${workflowId}`;

export function getDocumentIngestionQueue(): Queue {
  documentIngestionQueue ??= new Queue("document-ingestion", {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
    },
  });
  return documentIngestionQueue;
}

export function getWorkflowExecutionQueue(): Queue<WorkflowJobData> {
  workflowExecutionQueue ??= new Queue<WorkflowJobData>("workflow-execution", {
    connection: redisConnection(),
    defaultJobOptions: {
      // Workflow actions can have external side effects. Ambiguous transport failures
      // are not retried automatically because doing so could duplicate those actions.
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
    },
  });
  return workflowExecutionQueue;
}

export async function upsertWorkflowSchedule(workflow: {
  id: string;
  userId: string;
  cronExpression: string;
}): Promise<void> {
  await getWorkflowExecutionQueue().upsertJobScheduler(
    workflowSchedulerId(workflow.id),
    { pattern: workflow.cronExpression, tz: "UTC" },
    {
      name: "execute-workflow",
      data: { workflowId: workflow.id, userId: workflow.userId, trigger: "CRON" },
    },
  );
}

export async function removeWorkflowSchedule(workflowId: string): Promise<void> {
  await getWorkflowExecutionQueue().removeJobScheduler(workflowSchedulerId(workflowId));
}
