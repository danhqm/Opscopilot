import cronParser from "cron-parser";
import { z } from "zod";


const { parseExpression } = cronParser;

const stepIdSchema = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);
const templateString = z.string().max(8_000);
const jsonObjectSchema = z.record(z.string(), z.json()).refine(
  (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 32_768,
  "Webhook payload cannot exceed 32 KiB.",
);

export const agentWorkflowStepSchema = z
  .object({
    id: stepIdSchema,
    type: z.literal("agent"),
    prompt: templateString.min(1),
  })
  .strict();

const queryDatabaseStepSchema = z
  .object({
    id: stepIdSchema,
    type: z.literal("tool"),
    tool: z.literal("query_database"),
    arguments: z
      .object({
        query_name: z.enum(["document_status_summary", "recent_tasks", "recent_workflow_runs"]),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
  })
  .strict();

const searchDocumentsStepSchema = z
  .object({
    id: stepIdSchema,
    type: z.literal("tool"),
    tool: z.literal("search_documents"),
    arguments: z
      .object({
        query: templateString.min(1).max(2_000),
        top_k: z.number().int().min(1).max(8).optional(),
      })
      .strict(),
  })
  .strict();

const createTaskStepSchema = z
  .object({
    id: stepIdSchema,
    type: z.literal("tool"),
    tool: z.literal("create_task"),
    arguments: z
      .object({
        title: templateString.min(1).max(255),
        description: templateString.max(2_000).nullable().optional(),
        due_at: templateString.max(64).nullable().optional(),
      })
      .strict(),
  })
  .strict();

const sendWebhookStepSchema = z
  .object({
    id: stepIdSchema,
    type: z.literal("tool"),
    tool: z.literal("send_webhook"),
    arguments: z
      .object({
        url: templateString.min(1).max(2_000),
        payload: jsonObjectSchema,
      })
      .strict(),
  })
  .strict();

export const workflowStepSchema = z.union([
  agentWorkflowStepSchema,
  queryDatabaseStepSchema,
  searchDocumentsStepSchema,
  createTaskStepSchema,
  sendWebhookStepSchema,
]);

export const workflowStepsSchema = z
  .array(workflowStepSchema)
  .min(1)
  .max(20)
  .superRefine((steps, context) => {
    const ids = new Set<string>();
    steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Workflow step IDs must be unique.",
        });
      }
      ids.add(step.id);
    });
  });

export const workflowDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    triggerType: z.enum(["MANUAL", "CRON"]),
    cronExpression: z.string().trim().min(1).max(100).nullable().optional(),
    steps: workflowStepsSchema,
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((workflow, context) => {
    if (workflow.triggerType === "MANUAL" && workflow.cronExpression) {
      context.addIssue({
        code: "custom",
        path: ["cronExpression"],
        message: "Manual workflows cannot define a cron expression.",
      });
      return;
    }
    if (workflow.triggerType === "CRON") {
      if (!workflow.cronExpression) {
        context.addIssue({
          code: "custom",
          path: ["cronExpression"],
          message: "Cron workflows require a cron expression.",
        });
        return;
      }
      try {
        parseExpression(workflow.cronExpression, { tz: "UTC" }).next();
      } catch {
        context.addIssue({
          code: "custom",
          path: ["cronExpression"],
          message: "Cron expression is invalid.",
        });
      }
    }
  });

export const workflowUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(191).optional(),
    triggerType: z.enum(["MANUAL", "CRON"]).optional(),
    cronExpression: z.string().trim().min(1).max(100).nullable().optional(),
    steps: workflowStepsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one workflow field is required.");

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export function nextCronRun(cronExpression: string): Date {
  return parseExpression(cronExpression, { tz: "UTC" }).next().toDate();
}
