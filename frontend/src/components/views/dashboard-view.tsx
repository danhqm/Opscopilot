"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";

import type { WorkspaceView } from "@/components/workspace-shell";
import { StatusBadge } from "@/components/status-badge";
import { ViewHeader } from "@/components/view-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import type { Conversation, DocumentRecord, UsageSummary, Workflow } from "@/lib/types";

type DashboardData = {
  usage: UsageSummary;
  documents: DocumentRecord[];
  conversations: Conversation[];
  workflows: Workflow[];
};

const emptyUsage: UsageSummary = {
  period: "all_time",
  requests: 0,
  tokens: { input: 0, output: 0, total: 0 },
  documents: { total: 0, ready: 0, processing: 0, failed: 0 },
  workflows: { total: 0, active: 0 },
  runs: { total: 0, succeeded: 0, failed: 0 },
};

export function DashboardView({ onNavigate }: { onNavigate: (view: WorkspaceView) => void }) {
  const [data, setData] = useState<DashboardData>({ usage: emptyUsage, documents: [], conversations: [], workflows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [usage, documentPayload, conversationPayload, workflowPayload] = await Promise.all([
        apiRequest<UsageSummary>("/usage/summary"),
        apiRequest<{ documents: DocumentRecord[] }>("/documents"),
        apiRequest<{ conversations: Conversation[] }>("/conversations"),
        apiRequest<{ workflows: Workflow[] }>("/workflows"),
      ]);
      setData({
        usage,
        documents: documentPayload.documents,
        conversations: conversationPayload.conversations,
        workflows: workflowPayload.workflows,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const latestRun = data.workflows
    .filter((workflow) => workflow.lastRun)
    .toSorted((left, right) => new Date(right.lastRun!.createdAt).getTime() - new Date(left.lastRun!.createdAt).getTime())[0];
  const tokenTotal = Math.max(data.usage.tokens.total, 1);
  const successRate = data.usage.runs.total === 0 ? 0 : Math.round((data.usage.runs.succeeded / data.usage.runs.total) * 100);

  return (
    <div className="space-y-8">
      <ViewHeader
        eyebrow="Operational overview"
        title="Your command center"
        description="Monitor knowledge, conversations, and automation health from one live workspace."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} data-icon="inline-start" />
            Refresh
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Dashboard unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace totals">
        <MetricCard label="Agent requests" value={formatNumber(data.usage.requests)} detail="Completed responses" icon={Sparkles} loading={loading} />
        <MetricCard label="Tokens used" value={formatNumber(data.usage.tokens.total)} detail="Input + output" icon={Zap} loading={loading} />
        <MetricCard label="Ready sources" value={`${data.usage.documents.ready}/${data.usage.documents.total}`} detail="Documents indexed" icon={FileText} loading={loading} />
        <MetricCard label="Run success" value={`${successRate}%`} detail={`${data.usage.runs.total} total executions`} icon={CheckCircle2} loading={loading} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-border/80 bg-card/70">
          <CardHeader className="!flex flex-row items-center justify-between border-b border-border/70">
            <div>
              <CardTitle>Recent operations</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">The latest activity across your workspace</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("workflows")}>
              View workflows <ArrowRight data-icon="inline-end" />
            </Button>
          </CardHeader>
          <CardContent className="divide-y divide-border/70 px-0">
            {data.workflows.slice(0, 4).map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-white/[0.025]"
                onClick={() => onNavigate("workflows")}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
                  <WorkflowIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{workflow.name}</span>
                  <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                    {workflow.lastRun ? `Last run ${formatDate(workflow.lastRun.createdAt)}` : "No executions yet"}
                  </span>
                </span>
                <StatusBadge status={workflow.lastRun?.status ?? (workflow.isActive ? "ACTIVE" : "PAUSED")} />
              </button>
            ))}
            {!loading && data.workflows.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
                <WorkflowIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">No workflows yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Build your first repeatable operation.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => onNavigate("workflows")}>
                  Create workflow
                </Button>
              </div>
            ) : null}
            {loading ? <LoadingRows /> : null}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-[#121d27]">
          <CardHeader className="border-b border-border/70">
            <CardTitle>Usage mix</CardTitle>
            <p className="text-xs text-muted-foreground">Lifetime agent consumption</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Total tokens</span>
                <span className="font-mono text-xl font-medium">{formatNumber(data.usage.tokens.total)}</span>
              </div>
              <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted">
                <div className="bg-primary transition-all" style={{ width: `${(data.usage.tokens.input / tokenTotal) * 100}%` }} />
                <div className="bg-violet-400 transition-all" style={{ width: `${(data.usage.tokens.output / tokenTotal) * 100}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full bg-primary" />Input <span className="ml-auto font-mono text-foreground">{formatNumber(data.usage.tokens.input)}</span></div>
                <div className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full bg-violet-400" />Output <span className="ml-auto font-mono text-foreground">{formatNumber(data.usage.tokens.output)}</span></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-5">
              <MiniMetric label="Active workflows" value={data.usage.workflows.active} />
              <MiniMetric label="Queued sources" value={data.usage.documents.processing} />
              <MiniMetric label="Successful runs" value={data.usage.runs.succeeded} />
              <MiniMetric label="Failed runs" value={data.usage.runs.failed} tone={data.usage.runs.failed > 0 ? "danger" : "normal"} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <SnapshotCard
          title="Knowledge base"
          icon={FileText}
          onView={() => onNavigate("documents")}
          empty="Upload documents to ground your agent."
          items={data.documents.slice(0, 3).map((document) => ({
            id: document.id,
            title: document.filename,
            meta: document.chunkCount ? `${document.chunkCount} indexed chunks` : formatDate(document.createdAt),
            status: document.status,
          }))}
        />
        <SnapshotCard
          title="Conversations"
          icon={MessageSquareText}
          onView={() => onNavigate("chat")}
          empty="Start a conversation with your agent."
          items={data.conversations.slice(0, 3).map((conversation) => ({
            id: conversation.id,
            title: conversation.title,
            meta: conversation.lastMessage?.content ?? "No messages yet",
            status: `${conversation.messageCount} msg`,
          }))}
        />
      </section>

      {latestRun?.lastRun ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/45 p-4 text-sm">
          <Clock3 className="mt-0.5 size-4 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Latest execution · {latestRun.name}</p>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {latestRun.lastRun.output ? JSON.stringify(latestRun.lastRun.output) : "Execution output will appear here when the run completes."}
            </p>
          </div>
          <StatusBadge status={latestRun.lastRun.status} />
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, loading }: { label: string; value: string; detail: string; icon: typeof Sparkles; loading: boolean }) {
  return (
    <Card className="border-border/80 bg-card/65">
      <CardContent>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading ? <div className="mt-3 h-8 w-20 animate-pulse rounded bg-muted" /> : <p className="mt-2 font-mono text-3xl font-medium tracking-[-0.04em]">{value}</p>}
            <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
          </div>
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-background/60 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "danger" }) {
  return (
    <div className="rounded-lg bg-background/45 p-3">
      <p className={tone === "danger" ? "font-mono text-lg text-red-300" : "font-mono text-lg"}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-4 p-4">
      {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-muted/70" />)}
    </div>
  );
}

function SnapshotCard({ title, icon: Icon, items, empty, onView }: { title: string; icon: typeof FileText; items: Array<{ id: string; title: string; meta: string; status: string }>; empty: string; onView: () => void }) {
  return (
    <Card className="border-border/80 bg-card/55">
      <CardHeader className="!flex flex-row items-center justify-between border-b border-border/70">
        <div className="flex items-center gap-2"><Icon className="size-4 text-primary" aria-hidden="true" /><CardTitle>{title}</CardTitle></div>
        <Button variant="ghost" size="sm" onClick={onView}>Open <ArrowRight data-icon="inline-end" /></Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[0.025]">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.meta}</p></div>
            {item.status.includes("msg") ? <span className="font-mono text-[10px] text-muted-foreground">{item.status}</span> : <StatusBadge status={item.status} />}
          </div>
        ))}
        {items.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">{empty}</p> : null}
      </CardContent>
    </Card>
  );
}
