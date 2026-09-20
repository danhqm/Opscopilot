export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
};

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
};

export type MessageUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type Message = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  toolCalls: {
    tools?: Array<{ name?: string; arguments?: unknown }>;
    citations?: Array<{ filename?: string; chunk_index?: number; score?: number }>;
  } | null;
  model: string | null;
  usage: MessageUsage | null;
  createdAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: { content: string; role: string; createdAt: string } | null;
};

export type DocumentRecord = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  chunkCount: number | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};

export type WorkflowStep =
  | { id: string; type: "agent"; prompt: string }
  | {
      id: string;
      type: "tool";
      tool: "query_database";
      arguments: { query_name: "document_status_summary" | "recent_tasks" | "recent_workflow_runs"; limit?: number };
    }
  | { id: string; type: "tool"; tool: "search_documents"; arguments: { query: string; top_k?: number } }
  | {
      id: string;
      type: "tool";
      tool: "create_task";
      arguments: { title: string; description?: string | null; due_at?: string | null };
    }
  | { id: string; type: "tool"; tool: "send_webhook"; arguments: { url: string; payload: Record<string, unknown> } };

export type WorkflowRun = {
  id: string;
  workflowId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type Workflow = {
  id: string;
  name: string;
  triggerType: "MANUAL" | "CRON";
  cronExpression: string | null;
  steps: WorkflowStep[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  timezone: string;
  runCount: number;
  lastRun: WorkflowRun | null;
};

export type UsageSummary = {
  period: "all_time";
  requests: number;
  tokens: { input: number; output: number; total: number };
  documents: { total: number; ready: number; processing: number; failed: number };
  workflows: { total: number; active: number };
  runs: { total: number; succeeded: number; failed: number };
};
