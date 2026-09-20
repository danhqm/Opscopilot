"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  CircleAlert,
  CloudUpload,
  File,
  FileCheck2,
  FileClock,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ViewHeader } from "@/components/view-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import type { DocumentRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DocumentsView() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const payload = await apiRequest<{ documents: DocumentRecord[] }>("/documents");
      setDocuments(payload.documents);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Documents could not be loaded.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDocuments(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  const hasActiveIngestion = documents.some((document) => document.status === "PENDING" || document.status === "PROCESSING");
  useEffect(() => {
    if (!hasActiveIngestion) return;
    const timer = window.setInterval(() => void loadDocuments(), 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveIngestion, loadDocuments]);

  async function upload(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["pdf", "docx", "txt"].includes(extension)) {
      setError("Choose a PDF, DOCX, or plain-text file.");
      return;
    }
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    try {
      const payload = await apiRequest<{ document: DocumentRecord }>("/documents", { method: "POST", body });
      setDocuments((current) => [payload.document, ...current.filter((item) => item.id !== payload.document.id)]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The document could not be uploaded.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  const readyCount = documents.filter((document) => document.status === "DONE").length;
  const totalChunks = documents.reduce((total, document) => total + (document.chunkCount ?? 0), 0);

  return (
    <div className="space-y-8">
      <ViewHeader
        eyebrow="Knowledge layer"
        title="Document library"
        description="Upload source material, track ingestion, and make trusted context available to your agent."
        actions={
          <Button variant="outline" onClick={() => void loadDocuments(true)} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} data-icon="inline-start" /> Refresh
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Knowledge operation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <div
          className={cn(
            "relative flex min-h-60 flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed p-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/8" : "border-border bg-card/55 hover:border-primary/40",
          )}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="ops-grid pointer-events-none absolute inset-0 opacity-20" />
          <div className="relative flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            {uploading ? <Loader2 className="size-6 animate-spin" aria-hidden="true" /> : <CloudUpload className="size-6" aria-hidden="true" />}
          </div>
          <h2 className="relative mt-5 text-lg font-medium">{uploading ? "Uploading document…" : "Drop a document into the knowledge base"}</h2>
          <p className="relative mt-2 max-w-md text-sm leading-6 text-muted-foreground">PDF, DOCX, or TXT. The ingestion worker extracts, chunks, embeds, and isolates every source to your workspace.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="sr-only"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}
            disabled={uploading}
            aria-label="Choose a document to upload"
          />
          <Button className="relative mt-5" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Processing upload" : "Choose document"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <KnowledgeMetric icon={FileCheck2} label="Ready sources" value={readyCount} detail={`${documents.length} total`} />
          <KnowledgeMetric icon={FileText} label="Indexed chunks" value={totalChunks} detail="Searchable context" />
          <KnowledgeMetric icon={FileClock} label="In progress" value={documents.length - readyCount - documents.filter((item) => item.status === "FAILED").length} detail={hasActiveIngestion ? "Auto-refreshing" : "Queue clear"} />
          <KnowledgeMetric icon={ShieldCheck} label="Isolation" value="User" detail="Per-workspace vectors" />
        </div>
      </section>

      <Card className="border-border/80 bg-card/55">
        <CardContent className="px-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <div><h2 className="text-sm font-medium">Indexed sources</h2><p className="mt-0.5 text-xs text-muted-foreground">Status updates automatically while ingestion is active.</p></div>
            {hasActiveIngestion ? <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary"><span className="size-1.5 animate-pulse rounded-full bg-primary" />Live</span> : null}
          </div>
          {loading ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-muted/60" />)}</div>
          ) : documents.length === 0 ? (
            <div className="p-5"><EmptyState icon={File} title="No documents uploaded" description="Add your first source to start building the agent&apos;s grounded knowledge layer." action={{ label: "Upload a document", onClick: () => inputRef.current?.click() }} /></div>
          ) : (
            <div className="divide-y divide-border/70">
              {documents.map((document) => (
                <article key={document.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_120px_140px_auto] sm:items-center sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60 text-primary"><FileText className="size-4" aria-hidden="true" /></span>
                    <div className="min-w-0"><h3 className="truncate text-sm font-medium">{document.filename}</h3><p className="mt-1 font-mono text-[10px] text-muted-foreground">{formatBytes(document.sizeBytes)} · {document.mimeType.split("/").at(-1)?.toUpperCase()}</p></div>
                  </div>
                  <div className="pl-[52px] sm:pl-0"><p className="font-mono text-xs">{document.chunkCount ?? "—"}</p><p className="mt-0.5 text-[10px] text-muted-foreground">chunks</p></div>
                  <div className="pl-[52px] sm:pl-0"><p className="text-xs">{formatDate(document.processedAt ?? document.createdAt)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{document.processedAt ? "Processed" : "Uploaded"}</p></div>
                  <div className="pl-[52px] sm:pl-0"><StatusBadge status={document.status} /></div>
                  {document.failureReason ? <p className="pl-[52px] text-xs text-red-300 sm:col-span-4">{document.failureReason}</p> : null}
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KnowledgeMetric({ icon: Icon, label, value, detail }: { icon: typeof FileText; label: string; value: number | string; detail: string }) {
  return (
    <div className="flex min-h-28 flex-col rounded-xl border border-border bg-card/55 p-4">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <p className="mt-auto font-mono text-2xl font-medium">{value}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1"><span className="text-xs text-muted-foreground">{label}</span><span className="font-mono text-[9px] text-muted-foreground">{detail}</span></div>
    </div>
  );
}
