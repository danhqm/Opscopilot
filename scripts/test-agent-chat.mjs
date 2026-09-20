/** Exercise upload -> retrieval tool -> streamed answer -> persisted conversation. */
import { randomBytes } from "node:crypto";
import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.OPS_COPILOT_API_URL ?? "http://localhost:8080/api";
const scriptDir = dirname(fileURLToPath(import.meta.url));

async function request(path, { method = "GET", token, body, timeout = 30_000 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
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

async function main() {
  const samplePath = join(scriptDir, "rag-smoke.txt");
  const auth = await request("/auth/signup", {
    method: "POST",
    body: {
      email: `agent-smoke-${randomBytes(6).toString("hex")}@example.com`,
      password: "correct-horse-battery-staple",
    },
  });

  const form = new FormData();
  form.set("file", new File([await readFile(samplePath)], basename(samplePath), { type: "text/plain" }));
  const uploaded = await request("/documents", { method: "POST", token: auth.accessToken, body: form });
  const documentId = uploaded.document.id;

  let document = uploaded.document;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    document = (await request(`/documents/${documentId}`, { token: auth.accessToken })).document;
    if (["DONE", "FAILED"].includes(document.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (document.status !== "DONE") {
    throw new Error(`Ingestion ended with ${document.status}: ${document.failureReason ?? "no failure reason"}`);
  }

  const created = await request("/conversations", {
    method: "POST",
    token: auth.accessToken,
    body: { title: "Failover runbook check" },
  });
  const conversationId = created.conversation.id;
  const streamResponse = await fetch(`${baseUrl}/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: "Use the document search tool. What must the on-call engineer verify after database failover? Cite the source.",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const streamText = await streamResponse.text();
  if (!streamResponse.ok) {
    throw new Error(`Chat stream failed (${streamResponse.status}): ${streamText.slice(0, 500)}`);
  }

  const events = parseSse(streamText);
  const streamError = events.find((event) => event.event === "error");
  if (streamError) throw new Error(`Agent returned an error event: ${JSON.stringify(streamError.data)}`);
  const done = events.find((event) => event.event === "done");
  if (!done) throw new Error(`Chat stream had no done event: ${streamText.slice(0, 1_000)}`);
  const deltas = events.filter((event) => event.event === "delta").map((event) => String(event.data.delta ?? ""));
  if (!deltas.length || deltas.join("") !== done.data.content) {
    throw new Error("The streamed deltas did not reconstruct the completed assistant message.");
  }

  const answer = String(done.data.content ?? "").toLowerCase();
  for (const expected of ["replication", "writes", "operations log"]) {
    if (!answer.includes(expected)) throw new Error(`Agent answer omitted '${expected}': ${done.data.content}`);
  }
  if (!done.data.citations?.some((citation) => citation.filename === "rag-smoke.txt")) {
    throw new Error(`Agent completion did not include the expected citation: ${JSON.stringify(done.data.citations)}`);
  }

  const persisted = await request(`/conversations/${conversationId}`, { token: auth.accessToken });
  if (persisted.messages.length !== 2) {
    throw new Error(`Expected 2 persisted messages, received ${persisted.messages.length}.`);
  }
  const assistant = persisted.messages.find((message) => message.role === "ASSISTANT");
  const toolNames = assistant?.toolCalls?.tools?.map((tool) => tool.name) ?? [];
  if (!assistant?.usage?.totalTokens || !assistant.toolCalls?.citations?.length || !toolNames.includes("search_documents")) {
    throw new Error(`Assistant audit metadata was not persisted: ${JSON.stringify(assistant)}`);
  }

  console.log(JSON.stringify({ conversationId, answer: done.data.content, usage: done.data.usage, citations: done.data.citations }, null, 2));
}

main().catch((error) => {
  console.error(`Agent smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
