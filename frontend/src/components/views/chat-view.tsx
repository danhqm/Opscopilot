"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Bot,
  CircleAlert,
  FileText,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Send,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ViewHeader } from "@/components/view-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, streamChatMessage } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import type { Conversation, Message } from "@/lib/types";
import { cn } from "@/lib/utils";

const suggestions = [
  "Summarize the key risks in my uploaded documents.",
  "Show me the status of recent workflow runs.",
  "Create a task for the most important follow-up.",
];

export function ChatView() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const skipNextConversationLoadRef = useRef(false);

  async function loadConversations(selectFirst = true) {
    const payload = await apiRequest<{ conversations: Conversation[] }>("/conversations");
    setConversations(payload.conversations);
    if (selectFirst && !selectedId && payload.conversations[0]) setSelectedId(payload.conversations[0].id);
  }

  useEffect(() => {
    let active = true;
    void apiRequest<{ conversations: Conversation[] }>("/conversations")
      .then((payload) => {
        if (!active) return;
        setConversations(payload.conversations);
        if (payload.conversations[0]) setSelectedId(payload.conversations[0].id);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Conversations could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (skipNextConversationLoadRef.current) {
      skipNextConversationLoadRef.current = false;
      return;
    }
    let active = true;
    setLoading(true);
    void apiRequest<{ conversation: Conversation; messages: Message[] }>(`/conversations/${selectedId}`)
      .then((payload) => {
        if (active) setMessages(payload.messages);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "This conversation could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (scrollArea) scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  async function ensureConversation(firstMessage: string): Promise<string> {
    if (selectedId) return selectedId;
    const title = firstMessage.length > 52 ? `${firstMessage.slice(0, 49)}…` : firstMessage;
    const payload = await apiRequest<{ conversation: Conversation }>("/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    skipNextConversationLoadRef.current = true;
    setSelectedId(payload.conversation.id);
    setConversations((current) => [{ ...payload.conversation, messageCount: 0, lastMessage: null }, ...current]);
    return payload.conversation.id;
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || streaming) return;

    setDraft("");
    setError(null);
    setStreaming(true);
    let assistantId = `stream-${Date.now()}`;
    const optimisticUser: Message = {
      id: `user-${Date.now()}`,
      role: "USER",
      content: message,
      toolCalls: null,
      model: null,
      usage: null,
      createdAt: new Date().toISOString(),
    };
    const optimisticAssistant: Message = {
      id: assistantId,
      role: "ASSISTANT",
      content: "",
      toolCalls: null,
      model: null,
      usage: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, optimisticUser, optimisticAssistant]);

    try {
      const conversationId = await ensureConversation(message);
      await streamChatMessage(conversationId, message, {
        onStart(payload) {
          setMessages((current) => current.map((item) => (item.id === optimisticUser.id ? { ...item, id: payload.userMessageId } : item)));
        },
        onDelta(delta) {
          setMessages((current) => current.map((item) => (item.id === assistantId ? { ...item, content: item.content + delta } : item)));
        },
        onDone(payload) {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    id: payload.assistantMessageId,
                    content: payload.content,
                    model: payload.model,
                    usage: payload.usage,
                    toolCalls: payload.citations.length ? { citations: payload.citations } : null,
                  }
                : item,
            ),
          );
          assistantId = payload.assistantMessageId;
        },
      });
      await loadConversations(false);
    } catch (sendError) {
      setMessages((current) => current.filter((item) => item.id !== assistantId || item.content.length > 0));
      setError(sendError instanceof Error ? sendError.message : "The agent could not complete this response.");
    } finally {
      setStreaming(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function newConversation() {
    setSelectedId(null);
    setMessages([]);
    setDraft("");
    setError(null);
  }

  return (
    <div className="space-y-6">
      <ViewHeader
        eyebrow="Grounded intelligence"
        title="Agent chat"
        description="Ask questions across your knowledge base or let the agent take action through approved tools."
        actions={
          <Button onClick={newConversation}>
            <MessageSquarePlus data-icon="inline-start" /> New conversation
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Chat interrupted</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid min-h-[680px] overflow-hidden rounded-xl border border-border bg-card/55 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-[#111a23] p-3 lg:border-r lg:border-b-0">
          <div className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
            <PanelLeft className="size-4" aria-hidden="true" /> Conversations
            <span className="ml-auto font-mono text-[10px]">{conversations.length}</span>
          </div>
          <div className="mt-1 flex gap-2 overflow-x-auto pb-1 lg:block lg:max-h-[590px] lg:space-y-1 lg:overflow-y-auto lg:pb-0">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedId(conversation.id)}
                className={cn(
                  "min-w-56 rounded-lg border px-3 py-3 text-left transition-colors lg:block lg:w-full lg:min-w-0",
                  selectedId === conversation.id
                    ? "border-primary/20 bg-primary/8"
                    : "border-transparent hover:border-border hover:bg-white/[0.025]",
                )}
              >
                <span className="block truncate text-sm font-medium">{conversation.title}</span>
                <span className="mt-1.5 block truncate text-xs text-muted-foreground">
                  {conversation.lastMessage?.content ?? "No messages yet"}
                </span>
                <span className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                  <span>{formatDate(conversation.updatedAt)}</span><span>{conversation.messageCount} msg</span>
                </span>
              </button>
            ))}
            {!loading && conversations.length === 0 ? <p className="px-2 py-5 text-xs leading-5 text-muted-foreground">Your conversation history will appear here.</p> : null}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot className="size-4" aria-hidden="true" /></span>
              <div className="min-w-0"><p className="truncate text-sm font-medium">{conversations.find((item) => item.id === selectedId)?.title ?? "New conversation"}</p><p className="font-mono text-[10px] text-muted-foreground">RAG + MCP tools enabled</p></div>
            </div>
            <Badge variant="outline" className="border-emerald-400/20 text-emerald-300">Agent ready</Badge>
          </div>

          <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            {loading && messages.length === 0 ? (
              <div className="space-y-5"><MessageSkeleton side="left" /><MessageSkeleton side="right" /><MessageSkeleton side="left" /></div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-xl flex-col justify-center py-10">
                <EmptyState icon={Sparkles} title="What should we work on?" description="Your agent can search indexed documents, inspect operational data, and call approved MCP tools." />
                <div className="mt-5 grid gap-2">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" className="rounded-lg border border-border bg-background/45 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground" onClick={() => setDraft(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6">
                {messages.map((message) => <ChatMessage key={message.id} message={message} streaming={streaming && message.id.startsWith("stream-")} />)}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <form className="border-t border-border bg-background/35 p-3 sm:p-4" onSubmit={(event) => void sendMessage(event)}>
            <div className="mx-auto max-w-3xl rounded-xl border border-input bg-background/80 p-2 shadow-lg shadow-black/15 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Ask about your operations…"
                maxLength={8000}
                rows={2}
                className="min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                disabled={streaming}
                aria-label="Message the agent"
              />
              <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <p className="hidden text-[11px] text-muted-foreground sm:block">Enter to send · Shift + Enter for a new line</p>
                <p className="font-mono text-[10px] text-muted-foreground sm:hidden">{draft.length}/8000</p>
                <Button type="submit" disabled={!draft.trim() || streaming}>
                  {streaming ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                  {streaming ? "Thinking" : "Send"}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function ChatMessage({ message, streaming }: { message: Message; streaming: boolean }) {
  const user = message.role === "USER";
  const citations = message.toolCalls?.citations ?? [];
  const tools = message.toolCalls?.tools ?? [];
  return (
    <article className={cn("flex gap-3", user && "flex-row-reverse")}>
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", user ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary")}>
        {user ? <UserRound className="size-4" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
      </div>
      <div className={cn("min-w-0 max-w-[88%]", user && "text-right")}>
        <div className={cn("inline-block rounded-xl px-4 py-3 text-left", user ? "bg-primary text-primary-foreground" : "border border-border bg-background/55")}>
          {message.content ? <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p> : <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Agent is reasoning…</span>}
        </div>
        {!user && (citations.length > 0 || tools.length > 0) ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {citations.map((citation, index) => <Badge key={`${citation.filename}-${index}`} variant="outline"><FileText aria-hidden="true" />{citation.filename ?? `Source ${index + 1}`}</Badge>)}
            {tools.map((tool, index) => <Badge key={`${tool.name}-${index}`} variant="outline"><Wrench aria-hidden="true" />{tool.name ?? "Tool call"}</Badge>)}
          </div>
        ) : null}
        {!user && !streaming && message.usage ? <p className="mt-2 font-mono text-[10px] text-muted-foreground">{message.model ?? "agent"} · {formatNumber(message.usage.totalTokens)} tokens</p> : null}
      </div>
    </article>
  );
}

function MessageSkeleton({ side }: { side: "left" | "right" }) {
  return <div className={cn("flex gap-3", side === "right" && "flex-row-reverse")}><div className="size-8 animate-pulse rounded-lg bg-muted" /><div className="h-20 w-[min(80%,34rem)] animate-pulse rounded-xl bg-muted/70" /></div>;
}
