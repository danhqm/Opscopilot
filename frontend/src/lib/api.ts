import type { AuthResponse, AuthUser, MessageUsage } from "@/lib/types";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const accessTokenKey = "ops_copilot_access_token";

type ApiErrorPayload = {
  error?: { code?: string; message?: string; details?: Array<{ path: string; message: string }> };
  detail?: string;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(accessTokenKey);
}

export function saveAccessToken(token: string): void {
  window.sessionStorage.setItem(accessTokenKey, token);
}

export function clearAccessToken(): void {
  window.sessionStorage.removeItem(accessTokenKey);
}

async function parseApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json().catch(() => ({}))) as ApiErrorPayload)
    : {};
  const message = payload.error?.message ?? payload.detail ?? `Request failed (${response.status}).`;
  return new ApiError(response.status, payload.error?.code ?? "request_failed", message);
}

async function refreshSession(): Promise<AuthResponse | null> {
  const response = await fetch(`${apiBaseUrl}/auth/refresh`, { method: "POST", credentials: "include" });
  if (!response.ok) {
    clearAccessToken();
    return null;
  }
  const session = (await response.json()) as AuthResponse;
  saveAccessToken(session.accessToken);
  return session;
}

async function authorizedFetch(path: string, init: RequestInit = {}, allowRefresh = true): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: "include" });
  if (response.status !== 401 || !allowRefresh) return response;

  const refreshed = await refreshSession();
  if (!refreshed) return response;
  headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
  return fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: "include" });
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await authorizedFetch(path, { ...init, headers });
  if (!response.ok) throw await parseApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function authenticate(mode: "login" | "signup", email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/${mode}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await parseApiError(response);
  const session = (await response.json()) as AuthResponse;
  saveAccessToken(session.accessToken);
  return session;
}

export async function restoreSession(): Promise<AuthUser | null> {
  const token = getAccessToken();
  if (token) {
    const response = await authorizedFetch("/auth/me");
    if (response.ok) return ((await response.json()) as { user: AuthUser }).user;
  }
  return (await refreshSession())?.user ?? null;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${apiBaseUrl}/auth/logout`, { method: "POST", credentials: "include" });
  } finally {
    clearAccessToken();
  }
}

type StreamHandlers = {
  onStart?: (payload: { conversationId: string; userMessageId: string }) => void;
  onDelta: (delta: string) => void;
  onDone: (payload: {
    assistantMessageId: string;
    content: string;
    model: string;
    usage: MessageUsage;
    citations: Array<{ filename?: string; chunk_index?: number; score?: number }>;
  }) => void;
};

export async function streamChatMessage(conversationId: string, message: string, handlers: StreamHandlers): Promise<void> {
  const response = await authorizedFetch(`/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw await parseApiError(response);
  if (!response.body) throw new ApiError(502, "empty_stream", "The agent returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function dispatch(block: string) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    const payload = JSON.parse(data.join("\n")) as Record<string, unknown>;
    if (event === "start") handlers.onStart?.(payload as { conversationId: string; userMessageId: string });
    if (event === "delta") handlers.onDelta(String(payload.delta ?? ""));
    if (event === "done") handlers.onDone(payload as Parameters<StreamHandlers["onDone"]>[0]);
    if (event === "error") throw new ApiError(502, String(payload.code ?? "agent_unavailable"), String(payload.message ?? "The agent could not complete this response."));
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      dispatch(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
}
