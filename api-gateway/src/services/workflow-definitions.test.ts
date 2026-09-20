import { describe, expect, it } from "vitest";

import { nextCronRun, workflowDefinitionSchema } from "./workflow-definitions.js";


describe("workflow definitions", () => {
  it("accepts ordered agent and allow-listed tool steps", () => {
    const result = workflowDefinitionSchema.parse({
      name: "Daily operations summary",
      triggerType: "CRON",
      cronExpression: "0 9 * * *",
      isActive: true,
      steps: [
        { id: "summary", type: "agent", prompt: "Summarize new operations documents." },
        {
          id: "notify",
          type: "tool",
          tool: "send_webhook",
          arguments: {
            url: "https://example.com/hook",
            payload: { summary: "{{steps.summary.output}}" },
          },
        },
      ],
    });

    expect(result.steps).toHaveLength(2);
    expect(nextCronRun(result.cronExpression!)).toBeInstanceOf(Date);
  });

  it("rejects arbitrary tool names", () => {
    const result = workflowDefinitionSchema.safeParse({
      name: "Unsafe",
      triggerType: "MANUAL",
      steps: [{ id: "shell", type: "tool", tool: "run_shell", arguments: { command: "whoami" } }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate step IDs and invalid cron expressions", () => {
    const result = workflowDefinitionSchema.safeParse({
      name: "Invalid",
      triggerType: "CRON",
      cronExpression: "not a cron",
      steps: [
        { id: "same", type: "agent", prompt: "first" },
        { id: "same", type: "agent", prompt: "second" },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("unique"))).toBe(true);
      expect(result.error.issues.some((issue) => issue.message.includes("Cron"))).toBe(true);
    }
  });

  it("requires cron only for cron-triggered workflows", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        name: "Missing cron",
        triggerType: "CRON",
        steps: [{ id: "report", type: "agent", prompt: "Report" }],
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        name: "Manual with cron",
        triggerType: "MANUAL",
        cronExpression: "* * * * *",
        steps: [{ id: "report", type: "agent", prompt: "Report" }],
      }).success,
    ).toBe(false);
  });
});
