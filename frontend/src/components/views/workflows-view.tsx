"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CircleAlert,
  Clock3,
  Code2,
  Database,
  FileSearch,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ViewHeader } from "@/components/view-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";
import { formatDate, sentenceCase } from "@/lib/format";
import type { Workflow, WorkflowRun, WorkflowStep } from "@/lib/types";
import { cn } from "@/lib/utils";

type ToolName = "query_database" | "search_documents" | "create_task" | "send_webhook";

type StepDraft = {
  id: string;
  type: "agent" | "tool";
  tool: ToolName;
  prompt: string;
  queryName: "document_status_summary" | "recent_tasks" | "recent_workflow_runs";
  limit: number;
  query: string;
  topK: number;
  title: string;
  description: string;
  dueAt: string;
  url: string;
  payload: string;
};

type WorkflowDraft = {
  name: string;
  triggerType: "MANUAL" | "CRON";
  cronExpression: string;
  isActive: boolean;
  steps: StepDraft[];
};

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus:border-ring focus:ring-3 focus:ring-ring/50";

function createStep(index = 1): StepDraft {
  return {
    id: `step_${Date.now().toString(36)}_${index}`,
    type: "agent",
    tool: "search_documents",
    prompt: "",
    queryName: "document_status_summary",
    limit: 10,
    query: "",
    topK: 5,
    title: "",
    description: "",
    dueAt: "",
    url: "",
    payload: "{\n  \"message\": \"{{ steps.step_1.output }}\"\n}",
  };
}

const blankWorkflow = (): WorkflowDraft => ({
  name: "",
  triggerType: "MANUAL",
  cronExpression: "0 9 * * *",
  isActive: true,
  steps: [createStep()],
});

const toolOptions: Array<{ value: ToolName; label: string; icon: typeof Database }> = [
  { value: "query_database", label: "Query database", icon: Database },
  { value: "search_documents", label: "Search documents", icon: FileSearch },
  { value: "create_task", label: "Create task", icon: ListChecks },
  { value: "send_webhook", label: "Send webhook", icon: Webhook },
];

export function WorkflowsView() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft>(blankWorkflow);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    try {
      const payload = await apiRequest<{ workflows: Workflow[] }>("/workflows");
      setWorkflows(payload.workflows);
      setSelectedId((current) => current ?? payload.workflows[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Workflows could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (workflowId: string) => {
    try {
      const payload = await apiRequest<{ runs: WorkflowRun[] }>(`/workflows/${workflowId}/runs?limit=25`);
      setRuns(payload.runs);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Run history could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkflows(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkflows]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => void loadRuns(selectedId), 0);
    return () => window.clearTimeout(timer);
  }, [loadRuns, selectedId]);

  const hasLiveRun = runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING");
  useEffect(() => {
    if (!selectedId || !hasLiveRun) return;
    const timer = window.setInterval(() => {
      void Promise.all([loadRuns(selectedId), loadWorkflows()]);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasLiveRun, loadRuns, loadWorkflows, selectedId]);

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedId) ?? null;
  const stats = useMemo(() => ({
    active: workflows.filter((workflow) => workflow.isActive).length,
    scheduled: workflows.filter((workflow) => workflow.triggerType === "CRON" && workflow.isActive).length,
    succeeded: workflows.filter((workflow) => workflow.lastRun?.status === "SUCCEEDED").length,
  }), [workflows]);

  function openNewBuilder() {
    setDraft(blankWorkflow());
    setEditingId(null);
    setBuilderOpen(true);
    setError(null);
  }

  function openEditBuilder(workflow: Workflow) {
    setDraft({
      name: workflow.name,
      triggerType: workflow.triggerType,
      cronExpression: workflow.cronExpression ?? "0 9 * * *",
      isActive: workflow.isActive,
      steps: workflow.steps.map(stepToDraft),
    });
    setEditingId(workflow.id);
    setBuilderOpen(true);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)) }));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });
  }

  async function saveWorkflow(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: draft.name,
        triggerType: draft.triggerType,
        cronExpression: draft.triggerType === "CRON" ? draft.cronExpression : null,
        isActive: draft.isActive,
        steps: draft.steps.map(serializeStep),
      };
      const payload = await apiRequest<{ workflow: Workflow }>(editingId ? `/workflows/${editingId}` : "/workflows", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      setBuilderOpen(false);
      setEditingId(null);
      setSelectedId(payload.workflow.id);
      await loadWorkflows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The workflow could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function runWorkflow(workflow: Workflow) {
    setRunningId(workflow.id);
    setError(null);
    try {
      const payload = await apiRequest<{ run: WorkflowRun }>(`/workflows/${workflow.id}/runs`, { method: "POST" });
      setSelectedId(workflow.id);
      setRuns((current) => [payload.run, ...current.filter((run) => run.id !== payload.run.id)]);
      await loadWorkflows();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The workflow could not be queued.");
    } finally {
      setRunningId(null);
    }
  }

  async function toggleWorkflow(workflow: Workflow) {
    try {
      await apiRequest(`/workflows/${workflow.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !workflow.isActive }) });
      await loadWorkflows();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "The workflow status could not be changed.");
    }
  }

  return (
    <div className="space-y-8">
      <ViewHeader
        eyebrow="Automation engine"
        title="Workflows"
        description="Compose agent reasoning and approved tools into repeatable, observable operations. All schedules run in UTC."
        actions={<Button onClick={openNewBuilder}><Plus data-icon="inline-start" />New workflow</Button>}
      />

      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Workflow operation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {builderOpen ? (
        <WorkflowBuilder
          draft={draft}
          setDraft={setDraft}
          editing={Boolean(editingId)}
          saving={saving}
          onSave={saveWorkflow}
          onClose={() => setBuilderOpen(false)}
          onUpdateStep={updateStep}
          onMoveStep={moveStep}
        />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <WorkflowMetric icon={WorkflowIcon} label="Active workflows" value={stats.active} detail={`${workflows.length} defined`} />
        <WorkflowMetric icon={CalendarClock} label="Scheduled" value={stats.scheduled} detail="UTC schedules" />
        <WorkflowMetric icon={ListChecks} label="Healthy latest runs" value={stats.succeeded} detail="Across workflows" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
        <Card className="border-border/80 bg-card/55">
          <CardHeader className="!flex flex-row items-center justify-between border-b border-border/70">
            <div><CardTitle>Workflow registry</CardTitle><p className="mt-1 text-xs text-muted-foreground">Select a workflow to inspect its execution trail.</p></div>
            <Button variant="ghost" size="icon" onClick={() => void loadWorkflows()} aria-label="Refresh workflows"><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? <div className="space-y-3 p-4">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-muted/60" />)}</div> : null}
            {!loading && workflows.length === 0 ? <div className="p-4"><EmptyState icon={WorkflowIcon} title="No workflows defined" description="Create a form-based sequence of agent and tool steps, then run it manually or on a schedule." action={{ label: "Build a workflow", onClick: openNewBuilder }} /></div> : null}
            <div className="divide-y divide-border/70">
              {workflows.map((workflow) => (
                <article key={workflow.id} className={cn("p-4 transition-colors", selectedId === workflow.id && "bg-primary/[0.045]")}>
                  <button type="button" className="w-full text-left" onClick={() => setSelectedId(workflow.id)}>
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60 text-primary"><WorkflowIcon className="size-4" aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-medium">{workflow.name}</h3><p className="mt-1 font-mono text-[10px] text-muted-foreground">{workflow.triggerType === "CRON" ? `${workflow.cronExpression} · UTC` : "Manual trigger"} · {workflow.steps.length} steps</p></div>
                      <StatusBadge status={workflow.lastRun?.status ?? (workflow.isActive ? "ACTIVE" : "PAUSED")} />
                    </div>
                  </button>
                  <div className="mt-4 flex flex-wrap items-center gap-2 pl-12">
                    <Button size="sm" onClick={() => void runWorkflow(workflow)} disabled={runningId === workflow.id}>
                      {runningId === workflow.id ? <Loader2 className="animate-spin" /> : <Play />} Run now
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEditBuilder(workflow)}><Pencil />Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => void toggleWorkflow(workflow)}>{workflow.isActive ? "Pause" : "Activate"}</Button>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">{workflow.runCount ?? 0} runs</span>
                  </div>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit border-border/80 bg-[#121d27] xl:sticky xl:top-24">
          <CardHeader className="!flex flex-row items-center justify-between border-b border-border/70">
            <div><CardTitle>Execution history</CardTitle><p className="mt-1 truncate text-xs text-muted-foreground">{selectedWorkflow?.name ?? "Select a workflow"}</p></div>
            {hasLiveRun ? <Badge variant="outline" className="border-cyan-400/20 text-cyan-300"><span className="size-1.5 animate-pulse rounded-full bg-cyan-300" />Live</Badge> : null}
          </CardHeader>
          <CardContent className="px-0">
            {!selectedWorkflow ? <div className="p-4"><EmptyState icon={Clock3} title="No workflow selected" description="Choose a workflow to inspect its runs and output logs." /></div> : null}
            {selectedWorkflow && runs.length === 0 ? <div className="p-4"><EmptyState icon={Play} title="No runs yet" description="Run this workflow to create its first execution record." action={{ label: "Run now", onClick: () => void runWorkflow(selectedWorkflow) }} /></div> : null}
            <div className="max-h-[650px] divide-y divide-border/70 overflow-y-auto">
              {runs.map((run) => <RunRecord key={run.id} run={run} />)}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function WorkflowBuilder({
  draft,
  setDraft,
  editing,
  saving,
  onSave,
  onClose,
  onUpdateStep,
  onMoveStep,
}: {
  draft: WorkflowDraft;
  setDraft: React.Dispatch<React.SetStateAction<WorkflowDraft>>;
  editing: boolean;
  saving: boolean;
  onSave: (event: FormEvent) => void;
  onClose: () => void;
  onUpdateStep: (index: number, patch: Partial<StepDraft>) => void;
  onMoveStep: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <Card className="border-primary/20 bg-card/75 shadow-2xl shadow-black/20">
      <CardHeader className="!flex flex-row items-start justify-between border-b border-border">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Workflow builder</p><CardTitle className="mt-2">{editing ? "Edit automation" : "Compose a new automation"}</CardTitle><p className="mt-1 text-xs text-muted-foreground">Steps run from top to bottom. Reference earlier output with template variables.</p></div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close workflow builder"><X /></Button>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={onSave}>
          <div className="grid gap-4 md:grid-cols-[1fr_180px_1fr_auto] md:items-end">
            <div className="space-y-2"><Label htmlFor="workflow-name">Workflow name</Label><Input id="workflow-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Daily document briefing" maxLength={191} required /></div>
            <div className="space-y-2"><Label htmlFor="workflow-trigger">Trigger</Label><select id="workflow-trigger" className={selectClass} value={draft.triggerType} onChange={(event) => setDraft((current) => ({ ...current, triggerType: event.target.value as WorkflowDraft["triggerType"] }))}><option value="MANUAL">Manual</option><option value="CRON">Cron schedule</option></select></div>
            <div className="space-y-2"><Label htmlFor="workflow-cron">Cron expression (UTC)</Label><Input id="workflow-cron" value={draft.cronExpression} onChange={(event) => setDraft((current) => ({ ...current, cronExpression: event.target.value }))} disabled={draft.triggerType !== "CRON"} placeholder="0 9 * * *" required={draft.triggerType === "CRON"} /></div>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} className="accent-[var(--primary)]" />Active</label>
          </div>

          <div className="space-y-3">
            {draft.steps.map((step, index) => (
              <div key={step.id} className="rounded-xl border border-border bg-background/40">
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 font-mono text-xs text-primary">{index + 1}</span>
                  <div className="grid flex-1 gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
                    <select className={selectClass} value={step.type} onChange={(event) => onUpdateStep(index, { type: event.target.value as StepDraft["type"] })}><option value="agent">Agent reasoning</option><option value="tool">MCP tool</option></select>
                    <Input value={step.id} onChange={(event) => onUpdateStep(index, { id: event.target.value })} pattern="[a-z][a-z0-9_-]*" maxLength={64} aria-label={`Step ${index + 1} identifier`} required />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => onMoveStep(index, -1)} disabled={index === 0} aria-label="Move step up"><ArrowUp /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => onMoveStep(index, 1)} disabled={index === draft.steps.length - 1} aria-label="Move step down"><ArrowDown /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDraft((current) => ({ ...current, steps: current.steps.filter((_, itemIndex) => itemIndex !== index) }))} disabled={draft.steps.length === 1} aria-label="Remove step"><Trash2 /></Button>
                  </div>
                </div>
                <div className="p-4">
                  {step.type === "agent" ? (
                    <div className="space-y-2"><Label htmlFor={`${step.id}-prompt`}>Agent instruction</Label><Textarea id={`${step.id}-prompt`} value={step.prompt} onChange={(event) => onUpdateStep(index, { prompt: event.target.value })} placeholder="Summarize the indexed documents and identify decisions that need an owner." maxLength={8000} required /></div>
                  ) : (
                    <ToolStepEditor step={step} index={index} onUpdateStep={onUpdateStep} />
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
            <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, steps: [...current.steps, createStep(current.steps.length + 1)] }))}><Plus />Add step</Button>
            <p className="text-xs text-muted-foreground sm:ml-2">Use <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{"{{ steps.step_id.output }}"}</code> in later fields.</p>
            <div className="sm:ml-auto flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Code2 />}{editing ? "Save changes" : "Create workflow"}</Button></div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ToolStepEditor({ step, index, onUpdateStep }: { step: StepDraft; index: number; onUpdateStep: (index: number, patch: Partial<StepDraft>) => void }) {
  const selectedTool = toolOptions.find((tool) => tool.value === step.tool) ?? toolOptions[0];
  const ToolIcon = selectedTool.icon;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-end">
        <div className="space-y-2"><Label htmlFor={`${step.id}-tool`}>Approved tool</Label><select id={`${step.id}-tool`} className={selectClass} value={step.tool} onChange={(event) => onUpdateStep(index, { tool: event.target.value as ToolName })}>{toolOptions.map((tool) => <option key={tool.value} value={tool.value}>{tool.label}</option>)}</select></div>
        <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-primary/5 px-3 text-xs text-muted-foreground"><ToolIcon className="size-4 text-primary" aria-hidden="true" />Executes through the MCP protocol boundary</div>
      </div>
      {step.tool === "query_database" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]"><div className="space-y-2"><Label htmlFor={`${step.id}-query-name`}>Allowed query</Label><select id={`${step.id}-query-name`} className={selectClass} value={step.queryName} onChange={(event) => onUpdateStep(index, { queryName: event.target.value as StepDraft["queryName"] })}><option value="document_status_summary">Document status summary</option><option value="recent_tasks">Recent tasks</option><option value="recent_workflow_runs">Recent workflow runs</option></select></div><NumberField id={`${step.id}-limit`} label="Row limit" value={step.limit} min={1} max={50} onChange={(limit) => onUpdateStep(index, { limit })} /></div>
      ) : null}
      {step.tool === "search_documents" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]"><div className="space-y-2"><Label htmlFor={`${step.id}-query`}>Search query</Label><Input id={`${step.id}-query`} value={step.query} onChange={(event) => onUpdateStep(index, { query: event.target.value })} placeholder="Operational risks and pending decisions" required /></div><NumberField id={`${step.id}-top-k`} label="Top chunks" value={step.topK} min={1} max={8} onChange={(topK) => onUpdateStep(index, { topK })} /></div>
      ) : null}
      {step.tool === "create_task" ? (
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${step.id}-title`}>Task title</Label><Input id={`${step.id}-title`} value={step.title} onChange={(event) => onUpdateStep(index, { title: event.target.value })} placeholder="Review agent summary" required /></div><div className="space-y-2"><Label htmlFor={`${step.id}-due`}>Due at (ISO, optional)</Label><Input id={`${step.id}-due`} value={step.dueAt} onChange={(event) => onUpdateStep(index, { dueAt: event.target.value })} placeholder="2026-09-21T09:00:00Z" /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor={`${step.id}-description`}>Description</Label><Textarea id={`${step.id}-description`} value={step.description} onChange={(event) => onUpdateStep(index, { description: event.target.value })} placeholder="Include output from a previous step with a template variable." /></div></div>
      ) : null}
      {step.tool === "send_webhook" ? (
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label htmlFor={`${step.id}-url`}>HTTPS endpoint</Label><Input id={`${step.id}-url`} type="url" value={step.url} onChange={(event) => onUpdateStep(index, { url: event.target.value })} placeholder="https://hooks.example.com/ops" required /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor={`${step.id}-payload`}>JSON payload</Label><Textarea id={`${step.id}-payload`} value={step.payload} onChange={(event) => onUpdateStep(index, { payload: event.target.value })} className="min-h-32 font-mono text-xs" spellCheck={false} required /></div></div>
      ) : null}
    </div>
  );
}

function NumberField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" value={value} min={min} max={max} onChange={(event) => onChange(event.target.valueAsNumber)} required /></div>;
}

function WorkflowMetric({ icon: Icon, label, value, detail }: { icon: typeof WorkflowIcon; label: string; value: number; detail: string }) {
  return <div className="flex items-center gap-4 rounded-xl border border-border bg-card/55 p-4"><span className="flex size-10 items-center justify-center rounded-lg bg-primary/8 text-primary"><Icon className="size-5" aria-hidden="true" /></span><div><p className="font-mono text-2xl font-medium">{value}</p><p className="text-xs text-muted-foreground">{label} · {detail}</p></div></div>;
}

function RunRecord({ run }: { run: WorkflowRun }) {
  const output = run.output ? JSON.stringify(run.output, null, 2) : null;
  return (
    <details className="group p-4 open:bg-black/10">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-background/60"><Play className="size-3.5 text-primary" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="block font-mono text-xs">{run.id.slice(0, 8)}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{formatDate(run.startedAt ?? run.createdAt)}</span></span>
        <StatusBadge status={run.status} />
      </summary>
      <div className="mt-4 rounded-lg border border-border bg-[#0b1219] p-3">
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><span>Execution output</span><span>{run.finishedAt ? `Finished ${formatDate(run.finishedAt)}` : sentenceCase(run.status)}</span></div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-slate-300">{output ?? "Waiting for worker output…"}</pre>
      </div>
    </details>
  );
}

function serializeStep(step: StepDraft): WorkflowStep {
  if (step.type === "agent") return { id: step.id, type: "agent", prompt: step.prompt };
  if (step.tool === "query_database") return { id: step.id, type: "tool", tool: step.tool, arguments: { query_name: step.queryName, limit: step.limit } };
  if (step.tool === "search_documents") return { id: step.id, type: "tool", tool: step.tool, arguments: { query: step.query, top_k: step.topK } };
  if (step.tool === "create_task") return { id: step.id, type: "tool", tool: step.tool, arguments: { title: step.title, description: step.description || null, due_at: step.dueAt || null } };
  const parsed = JSON.parse(step.payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Webhook payload must be a JSON object.");
  return { id: step.id, type: "tool", tool: "send_webhook", arguments: { url: step.url, payload: parsed as Record<string, unknown> } };
}

function stepToDraft(step: WorkflowStep, index: number): StepDraft {
  const draft = createStep(index + 1);
  draft.id = step.id;
  draft.type = step.type;
  if (step.type === "agent") {
    draft.prompt = step.prompt;
    return draft;
  }
  draft.tool = step.tool;
  if (step.tool === "query_database") { draft.queryName = step.arguments.query_name; draft.limit = step.arguments.limit ?? 10; }
  if (step.tool === "search_documents") { draft.query = step.arguments.query; draft.topK = step.arguments.top_k ?? 5; }
  if (step.tool === "create_task") { draft.title = step.arguments.title; draft.description = step.arguments.description ?? ""; draft.dueAt = step.arguments.due_at ?? ""; }
  if (step.tool === "send_webhook") { draft.url = step.arguments.url; draft.payload = JSON.stringify(step.arguments.payload, null, 2); }
  return draft;
}
