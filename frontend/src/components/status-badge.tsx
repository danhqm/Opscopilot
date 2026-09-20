import { Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  DONE: "border-emerald-400/25 bg-emerald-400/8 text-emerald-300",
  SUCCEEDED: "border-emerald-400/25 bg-emerald-400/8 text-emerald-300",
  ACTIVE: "border-emerald-400/25 bg-emerald-400/8 text-emerald-300",
  PROCESSING: "border-cyan-400/25 bg-cyan-400/8 text-cyan-300",
  RUNNING: "border-cyan-400/25 bg-cyan-400/8 text-cyan-300",
  QUEUED: "border-amber-300/25 bg-amber-300/8 text-amber-200",
  PENDING: "border-amber-300/25 bg-amber-300/8 text-amber-200",
  FAILED: "border-red-400/25 bg-red-400/8 text-red-300",
  CANCELLED: "border-slate-400/25 bg-slate-400/8 text-slate-300",
  PAUSED: "border-slate-400/25 bg-slate-400/8 text-slate-300",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = status === "DONE" ? "Ready" : status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <Badge variant="outline" className={cn("gap-1.5", statusStyles[status] ?? statusStyles.PAUSED, className)}>
      <Circle className={cn("size-1.5 fill-current", ["PROCESSING", "RUNNING"].includes(status) && "animate-pulse")} aria-hidden="true" />
      {label}
    </Badge>
  );
}
