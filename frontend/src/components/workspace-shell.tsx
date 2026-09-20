"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Files,
  Gauge,
  LogOut,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";

import { ChatView } from "@/components/views/chat-view";
import { DashboardView } from "@/components/views/dashboard-view";
import { DocumentsView } from "@/components/views/documents-view";
import { WorkflowsView } from "@/components/views/workflows-view";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { logout, restoreSession } from "@/lib/api";
import type { AuthUser } from "@/lib/types";
import { cn } from "@/lib/utils";

export type WorkspaceView = "dashboard" | "chat" | "documents" | "workflows";

const navigation = [
  { id: "dashboard", label: "Overview", icon: Gauge },
  { id: "chat", label: "Agent chat", icon: MessageSquareText },
  { id: "documents", label: "Knowledge", icon: Files },
  { id: "workflows", label: "Automations", icon: Workflow },
] as const;

export function WorkspaceShell() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("dashboard");
  const [checkingSession, setCheckingSession] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void restoreSession()
      .then((sessionUser) => {
        if (!active) return;
        if (!sessionUser) {
          router.replace("/");
          return;
        }
        setUser(sessionUser);
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  function navigate(view: WorkspaceView) {
    setActiveView(view);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  async function signOut() {
    await logout();
    router.replace("/");
  }

  if (checkingSession || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Sparkles className="size-4 animate-pulse text-primary" aria-hidden="true" />
          Preparing your operations workspace…
        </div>
      </main>
    );
  }

  const view =
    activeView === "chat" ? (
      <ChatView />
    ) : activeView === "documents" ? (
      <DocumentsView />
    ) : activeView === "workflows" ? (
      <WorkflowsView />
    ) : (
      <DashboardView onNavigate={navigate} />
    );

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm lg:hidden"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[min(82vw,280px)] flex-col border-r border-border bg-[#101821] px-4 py-5 transition-transform lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-auto lg:translate-x-0",
          sidebarOpen ? "flex translate-x-0" : "hidden -translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-2">
          <button type="button" className="flex items-center gap-3 text-left" onClick={() => navigate("dashboard")}>
            <span className="flex size-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
              <Bot className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">Ops Copilot</span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Command center</span>
            </span>
          </button>
          <Button className="lg:hidden" variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-8 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workspace</div>
        <nav className="mt-2 space-y-1" aria-label="Workspace navigation">
          {navigation.map(({ id, label, icon: Icon }) => {
            const active = activeView === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => navigate(id)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
                )}
              >
                <Icon className="size-[18px]" aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {active ? <span className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" /> : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto">
          <div className="rounded-xl border border-border bg-white/[0.025] p-3">
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              Systems operational
            </div>
            <p className="mt-2 font-mono text-[10px] leading-5 text-muted-foreground">API · Agent · Queue · Vector store</p>
          </div>
          <Separator className="my-4" />
          <div className="flex items-center gap-3 px-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
              {user.email.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{user.email}</p>
              <p className="font-mono text-[10px] text-muted-foreground">Workspace owner</p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void signOut()} aria-label="Sign out">
              <LogOut aria-hidden="true" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="min-w-0" inert={sidebarOpen ? true : undefined}>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/88 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
              <Menu aria-hidden="true" />
            </Button>
            <PanelLeftClose className="hidden size-4 text-muted-foreground lg:block" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Operations workspace</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-primary sm:inline">/ {activeView}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Live
          </div>
        </header>
        <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-[1600px] p-4 sm:p-6 lg:p-8 xl:p-10">{view}</main>
      </div>
    </div>
  );
}
