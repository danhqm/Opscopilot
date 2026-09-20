import { Activity, Bot, Database, Workflow } from "lucide-react";

import { AuthPanel } from "@/components/auth-panel";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const capabilities = [
  { icon: Database, label: "Document-aware answers", detail: "RAG workspace" },
  { icon: Workflow, label: "Repeatable operations", detail: "Workflow engine" },
  { icon: Activity, label: "Trace every action", detail: "Execution history" },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-[1440px] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative flex min-h-[42rem] flex-col overflow-hidden border-b border-border px-6 py-6 lg:min-h-screen lg:border-r lg:border-b-0 lg:px-12 lg:py-10">
          <div className="ops-grid pointer-events-none absolute inset-0 opacity-45" />
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Bot className="size-5" aria-hidden="true" />
              </div>
              <span className="text-base font-semibold tracking-tight">Ops Copilot</span>
            </div>
            <Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/5 text-emerald-300">
              Phase 6 online
            </Badge>
          </div>

          <div className="relative z-10 my-auto max-w-2xl py-16">
            <p className="mb-5 font-mono text-sm font-medium uppercase tracking-[0.2em] text-primary">
              Agent operations workspace
            </p>
            <h1 className="max-w-xl text-5xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              Turn scattered knowledge into reliable action.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Bring documents, data, and scheduled work into one controlled agent workspace. Every answer stays grounded; every action leaves a trace.
            </p>

            <div className="mt-12 grid gap-3 sm:grid-cols-3">
              {capabilities.map(({ icon: Icon, label, detail }) => (
                <div key={label} className="border-l border-border pl-4">
                  <Icon className="mb-6 size-5 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">{label}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10">
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 font-mono text-xs text-muted-foreground">
              <span>Secure by default</span>
              <span>Next.js · Node.js · FastAPI</span>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-16 sm:px-12 lg:px-16">
          <AuthPanel />
        </section>
      </div>
    </main>
  );
}
