/** Exercise agent -> MCP -> MySQL/public webhook calls and persisted audit metadata. */
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
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

function parseSse(raw) {
  return raw
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
      return { event, data: data ? JSON.parse(data) : {} };
    });
}

async function sendMessage(token, conversationId, message) {
  const response = await fetch(`${baseUrl}/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Chat stream failed (${response.status}): ${raw.slice(0, 500)}`);
  const events = parseSse(raw);
  const streamError = events.find((event) => event.event === "error");
  if (streamError) throw new Error(`Agent returned an error event: ${JSON.stringify(streamError.data)}`);
  const done = events.find((event) => event.event === "done");
  if (!done) throw new Error(`Chat stream had no done event: ${raw.slice(0, 1_000)}`);
  return done.data;
}

async function main() {
  const suffix = randomBytes(5).toString("hex");
  const taskTitle = `MCP phase 4 smoke ${suffix}`;
  const auth = await request("/auth/signup", {
    method: "POST",
    body: {
      email: `mcp-smoke-${suffix}@example.com`,
      password: "correct-horse-battery-staple",
    },
  });
  const created = await request("/conversations", {
    method: "POST",
    token: auth.accessToken,
    body: { title: "MCP tool check" },
  });
  const conversationId = created.conversation.id;

  await sendMessage(
    auth.accessToken,
    conversationId,
    `Explicitly call create_task exactly once now. Create a task titled "${taskTitle}" with description "Created by the Phase 4 MCP smoke test".`,
  );
  const queryResult = await sendMessage(
    auth.accessToken,
    conversationId,
    `Call query_database with query_name recent_tasks now. Confirm that the result contains the exact title "${taskTitle}".`,
  );
  await sendMessage(
    auth.accessToken,
    conversationId,
    'Explicitly call send_webhook exactly once now. POST to https://httpbingo.org/post with JSON payload {"event":"ops_copilot_phase4_smoke","safe":true}.',
  );

  if (!String(queryResult.content ?? "").includes(taskTitle)) {
    throw new Error(`Database result did not mention the created task: ${queryResult.content}`);
  }

  const persisted = await request(`/conversations/${conversationId}`, { token: auth.accessToken });
  const toolCalls = persisted.messages
    .filter((message) => message.role === "ASSISTANT")
    .flatMap((message) => message.toolCalls?.tools ?? []);
  const names = toolCalls.map((tool) => tool.name);
  for (const expected of ["create_task", "query_database", "send_webhook"]) {
    if (!names.includes(expected)) throw new Error(`Missing ${expected} audit entry: ${JSON.stringify(toolCalls)}`);
  }
  const webhook = toolCalls.find((tool) => tool.name === "send_webhook");
  if (!webhook?.result?.delivered || webhook.result.status_code !== 200) {
    throw new Error(`Webhook was not delivered successfully: ${JSON.stringify(webhook)}`);
  }
  if ("payload" in (webhook.arguments ?? {})) {
    throw new Error(`Webhook payload values leaked into persisted audit metadata: ${JSON.stringify(webhook)}`);
  }

  console.log(JSON.stringify({ conversationId, taskTitle, tools: toolCalls }, null, 2));
}

main().catch((error) => {
  console.error(`MCP smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
