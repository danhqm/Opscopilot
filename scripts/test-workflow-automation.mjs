/** Exercise CRUD -> BullMQ manual/cron dispatch -> agent/MCP steps -> MySQL run logs. */
import { randomBytes } from "node:crypto";

const baseUrl = process.env.OPS_COPILOT_API_URL ?? "http://localhost:8080/api";

async function request(path, { method = "GET", token, body, timeout = 30_000 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForRun(token, workflowId, runId, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await request(`/workflows/${workflowId}/runs/${runId}`, { token });
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(result.run.status)) return result.run;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Workflow run ${runId} did not finish within ${timeout}ms.`);
}

async function waitForScheduledRun(token, workflowId, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await request(`/workflows/${workflowId}/runs?limit=5`, { token });
    const terminal = result.runs.find((run) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status));
    if (terminal) return terminal;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Scheduled workflow ${workflowId} did not produce a terminal run within ${timeout}ms.`);
}

async function main() {
  const suffix = randomBytes(5).toString("hex");
  const taskTitle = `Phase 5 workflow task ${suffix}`;
  const auth = await request("/auth/signup", {
    method: "POST",
    body: {
      email: `workflow-smoke-${suffix}@example.com`,
      password: "correct-horse-battery-staple",
    },
  });

  const invalid = await fetch(`${baseUrl}/workflows`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Unsafe workflow",
      triggerType: "MANUAL",
      steps: [{ id: "unsafe", type: "tool", tool: "run_shell", arguments: { command: "whoami" } }],
    }),
  });
  if (invalid.status !== 400) {
    throw new Error(`Expected arbitrary workflow tool validation to return 400, received ${invalid.status}.`);
  }

  const manual = await request("/workflows", {
    method: "POST",
    token: auth.accessToken,
    body: {
      name: `Manual MCP workflow ${suffix}`,
      triggerType: "MANUAL",
      isActive: true,
      steps: [
        {
          id: "compose",
          type: "agent",
          prompt: "Reply with exactly: workflow-agent-ready",
        },
        {
          id: "create",
          type: "tool",
          tool: "create_task",
          arguments: {
            title: taskTitle,
            description: "Agent step said: {{steps.compose.output}}",
          },
        },
        {
          id: "verify",
          type: "tool",
          tool: "query_database",
          arguments: { query_name: "recent_tasks", limit: 5 },
        },
      ],
    },
  });
  const workflowId = manual.workflow.id;
  const queued = await request(`/workflows/${workflowId}/runs`, {
    method: "POST",
    token: auth.accessToken,
  });
  const manualRun = await waitForRun(auth.accessToken, workflowId, queued.run.id);
  if (manualRun.status !== "SUCCEEDED") {
    throw new Error(`Manual workflow failed: ${JSON.stringify(manualRun.output)}`);
  }
  const manualSteps = manualRun.output?.steps ?? [];
  if (manualSteps.length !== 3 || manualSteps.some((step) => step.status !== "SUCCEEDED")) {
    throw new Error(`Manual step logs are incomplete: ${JSON.stringify(manualSteps)}`);
  }
  const createdTask = manualSteps.find((step) => step.id === "create")?.output?.task;
  if (createdTask?.title !== taskTitle || !String(createdTask.description).includes("workflow-agent-ready")) {
    throw new Error(`Workflow output templating or task creation failed: ${JSON.stringify(createdTask)}`);
  }
  const queriedRows = manualSteps.find((step) => step.id === "verify")?.output?.rows ?? [];
  if (!queriedRows.some((row) => row.title === taskTitle)) {
    throw new Error(`Whitelisted query did not read back the workflow task: ${JSON.stringify(queriedRows)}`);
  }

  const scheduled = await request("/workflows", {
    method: "POST",
    token: auth.accessToken,
    body: {
      name: `Scheduled report ${suffix}`,
      triggerType: "CRON",
      cronExpression: "*/10 * * * * *",
      isActive: true,
      steps: [
        {
          id: "report",
          type: "tool",
          tool: "query_database",
          arguments: { query_name: "recent_tasks", limit: 5 },
        },
      ],
    },
  });
  if (!scheduled.workflow.nextRunAt || scheduled.workflow.timezone !== "UTC") {
    throw new Error(`Scheduled workflow metadata is missing: ${JSON.stringify(scheduled.workflow)}`);
  }
  const scheduledRun = await waitForScheduledRun(auth.accessToken, scheduled.workflow.id);
  const deactivated = await request(`/workflows/${scheduled.workflow.id}`, {
    method: "PATCH",
    token: auth.accessToken,
    body: { isActive: false },
  });
  if (deactivated.workflow.nextRunAt !== null) {
    throw new Error(`Deactivated workflow still reports a next run: ${JSON.stringify(deactivated.workflow)}`);
  }
  if (scheduledRun.status !== "SUCCEEDED") {
    throw new Error(`Scheduled workflow failed: ${JSON.stringify(scheduledRun.output)}`);
  }

  const listed = await request("/workflows", { token: auth.accessToken });
  if (!listed.workflows.some((workflow) => workflow.id === workflowId && workflow.runCount >= 1)) {
    throw new Error(`Workflow list omitted run metadata: ${JSON.stringify(listed.workflows)}`);
  }

  const failing = await request("/workflows", {
    method: "POST",
    token: auth.accessToken,
    body: {
      name: `Failure log check ${suffix}`,
      triggerType: "MANUAL",
      steps: [
        {
          id: "broken",
          type: "agent",
          prompt: "{{previous.output}}",
        },
      ],
    },
  });
  const failingQueued = await request(`/workflows/${failing.workflow.id}/runs`, {
    method: "POST",
    token: auth.accessToken,
  });
  const failedRun = await waitForRun(auth.accessToken, failing.workflow.id, failingQueued.run.id);
  const failedStep = failedRun.output?.steps?.[0];
  if (failedRun.status !== "FAILED" || failedStep?.status !== "FAILED" || !failedStep.error) {
    throw new Error(`Failed workflow did not persist its step error: ${JSON.stringify(failedRun)}`);
  }

  console.log(
    JSON.stringify(
      {
        manualWorkflowId: workflowId,
        manualRunId: manualRun.id,
        scheduledWorkflowId: scheduled.workflow.id,
        scheduledRunId: scheduledRun.id,
        failedRunId: failedRun.id,
        taskTitle,
        manualSteps,
        scheduledSteps: scheduledRun.output?.steps,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Workflow smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
