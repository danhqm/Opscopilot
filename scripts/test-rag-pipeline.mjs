/** Exercise signup -> upload -> ingestion -> retrieval against the running Compose stack. */
import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const baseUrl = process.env.OPS_COPILOT_API_URL ?? "http://localhost:8080/api";
const scriptDir = dirname(fileURLToPath(import.meta.url));

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const readinessResponse = await fetch(new URL("/agent/ready", baseUrl), { signal: AbortSignal.timeout(10_000) });
  const readinessText = await readinessResponse.text();
  let readiness;
  try {
    readiness = JSON.parse(readinessText);
  } catch {
    throw new Error(
      `Agent readiness returned ${readinessResponse.status} ${readinessResponse.statusText} with non-JSON content: ${readinessText.slice(0, 120)}`,
    );
  }
  if (!readinessResponse.ok || !readiness.dependencies?.openai_key_configured) {
    throw new Error("OPENAI_API_KEY is not configured in the running agent service; set it in .env and rebuild the service.");
  }

  const samplePath = join(scriptDir, "rag-smoke.txt");
  const auth = await request("/auth/signup", {
    method: "POST",
    body: {
      email: `rag-smoke-${randomBytes(6).toString("hex")}@example.com`,
      password: "correct-horse-battery-staple",
    },
  });

  const form = new FormData();
  form.set("file", new File([await readFile(samplePath)], basename(samplePath), { type: "text/plain" }));
  const uploaded = await request("/documents", { method: "POST", token: auth.accessToken, body: form });
  const documentId = uploaded.document.id;
  console.log(`Queued document ${documentId}`);

  let document = uploaded.document;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    document = (await request(`/documents/${documentId}`, { token: auth.accessToken })).document;
    if (["DONE", "FAILED"].includes(document.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (document.status !== "DONE") {
    throw new Error(`Ingestion ended with ${document.status}: ${document.failureReason ?? "no failure reason"}`);
  }

  const results = await request("/documents/search", {
    method: "POST",
    token: auth.accessToken,
    body: {
      query: "What must the on-call engineer verify after failover?",
      documentId,
      topK: 3,
    },
  });
  if (!results.matches?.length) throw new Error("Retrieval returned no matches.");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(`RAG smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
