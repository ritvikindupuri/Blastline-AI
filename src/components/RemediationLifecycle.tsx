import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Eye,
  ShieldCheck,
  PlayCircle,
  Undo2,
  XCircle,
  Clock,
  User as UserIcon,
  Lock,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";

export type LifecycleState =
  | "proposed"
  | "reviewed"
  | "approved"
  | "executed"
  | "verified"
  | "rolled_back"
  | "rejected";

const STAGES: { key: LifecycleState; label: string; Icon: LucideIcon }[] = [
  { key: "proposed", label: "Proposed", Icon: Clock },
  { key: "reviewed", label: "Reviewed", Icon: Eye },
  { key: "approved", label: "Approved", Icon: ShieldCheck },
  { key: "executed", label: "Executed", Icon: PlayCircle },
  { key: "verified", label: "Verified", Icon: CheckCircle2 },
];

function stageIndex(s?: string) {
  const i = STAGES.findIndex((x) => x.key === s);
  return i < 0 ? 0 : i;
}

type Props = {
  remediation: any;
  currentUserId: string | null;
  requireSeparateApprover: boolean;
  onChange?: () => void;
};

export function RemediationLifecycle({ remediation: r, currentUserId, requireSeparateApprover, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [showTrail, setShowTrail] = useState(false);
  const [reviewNote, setReviewNote] = useState("");

  async function loadEvents() {
    const { data } = await supabase
      .from("remediation_events")
      .select("*")
      .eq("remediation_id", r.id)
      .order("created_at", { ascending: true });
    setEvents(data ?? []);
  }
  useEffect(() => { loadEvents(); /* eslint-disable-next-line */ }, [r.id, r.lifecycle_state]);

  const idx = stageIndex(r.lifecycle_state);
  const isRolledBack = r.lifecycle_state === "rolled_back";
  const isRejected = r.lifecycle_state === "rejected";

  // Approval gating: separate approver?
  const proposerId = r.user_id;
  const reviewerId = r.reviewed_by ?? null;
  const sameAsProposer = currentUserId && currentUserId === proposerId;
  const approvalBlocked = requireSeparateApprover && r.lifecycle_state === "reviewed" && sameAsProposer && reviewerId === currentUserId;

  async function transition(next: LifecycleState, extra: Record<string, any> = {}) {
    setBusy(next);
    const patch: Record<string, any> = { lifecycle_state: next, ...extra };
    if (next === "verified") {
      patch.verification_result = { verified_at: new Date().toISOString(), method: "manual", note: "Operator confirmed change in AWS console" };
    }
    const { error } = await supabase.from("remediations").update(patch as any).eq("id", r.id);
    setBusy(null);
    if (error) {
      alert(error.message);
      return;
    }
    onChange?.();
    loadEvents();
  }

  return (
    <div className="mt-4 rounded-md border border-border bg-background/40">
      {/* Stepper */}
      <div className="flex items-stretch gap-0 border-b border-border/60 px-3 py-3 overflow-x-auto">
        {STAGES.map((s, i) => {
          const reached = i <= idx && !isRejected;
          const current = i === idx && !isRejected && !isRolledBack;
          const Icon = s.Icon;
          return (
            <div key={s.key} className="flex items-center gap-2 shrink-0">
              <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                current ? "border-primary bg-primary/15 text-primary shadow-glow"
                : reached ? "border-success/50 bg-success/10 text-success"
                : "border-border/60 bg-background/60 text-muted-foreground"
              }`}>
                <Icon className="h-3 w-3" />
                {s.label}
              </div>
              {i < STAGES.length - 1 && (
                <div className={`h-px w-5 ${i < idx ? "bg-success/60" : "bg-border"}`} />
              )}
            </div>
          );
        })}
        {isRolledBack && (
          <div className="ml-3 flex items-center gap-1.5 rounded-md border border-sev-high/50 bg-sev-high/10 px-2 py-1 text-[10px] font-mono uppercase text-sev-high">
            <Undo2 className="h-3 w-3" /> Rolled back
          </div>
        )}
        {isRejected && (
          <div className="ml-3 flex items-center gap-1.5 rounded-md border border-sev-critical/50 bg-sev-critical/10 px-2 py-1 text-[10px] font-mono uppercase text-sev-critical">
            <XCircle className="h-3 w-3" /> Rejected
          </div>
        )}
      </div>

      {/* Actor metadata */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-3 py-2 text-[10px] font-mono">
        <ActorCell label="Proposed by" id={r.user_id} ts={r.created_at} />
        <ActorCell label="Reviewed by" id={r.reviewed_by} ts={r.reviewed_at} />
        <ActorCell label="Approved by" id={r.approved_by} ts={r.approved_at} />
        <ActorCell label="Executed by" id={r.executed_by} ts={r.executed_at} />
        <ActorCell label="Verified by" id={r.verified_by} ts={r.verified_at} />
      </div>

      {/* Action buttons (gated) */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-2.5">
        {r.lifecycle_state === "proposed" && (
          <>
            <input
              type="text"
              placeholder="Optional review note…"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              className="flex-1 min-w-[200px] rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs font-mono focus:border-primary focus:outline-none"
            />
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => transition("reviewed", reviewNote ? { review_notes: reviewNote } : {})} className="gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Mark reviewed
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => transition("rejected")} className="gap-1.5 text-sev-critical hover:text-sev-critical">
              <XCircle className="h-3.5 w-3.5" /> Reject
            </Button>
          </>
        )}
        {r.lifecycle_state === "reviewed" && (
          <>
            {approvalBlocked ? (
              <div className="flex items-center gap-2 text-xs text-sev-high font-mono">
                <Lock className="h-3.5 w-3.5" />
                A different approver is required by this connection.
              </div>
            ) : (
              <Button size="sm" disabled={!!busy} onClick={() => transition("approved")} className="gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Approve
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => transition("rejected")} className="gap-1.5 text-sev-critical hover:text-sev-critical">
              <XCircle className="h-3.5 w-3.5" /> Reject
            </Button>
          </>
        )}
        {r.lifecycle_state === "approved" && (
          <Button size="sm" disabled={!!busy} onClick={() => transition("executed")} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
            <PlayCircle className="h-3.5 w-3.5" /> Execute remediation
          </Button>
        )}
        {r.lifecycle_state === "executed" && (
          <>
            <Button size="sm" disabled={!!busy} onClick={() => transition("verified")} className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark verified
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => transition("rolled_back", { rollback_reason: "Manual rollback initiated by operator" })} className="gap-1.5 border-sev-high/40 text-sev-high hover:bg-sev-high/10">
              <Undo2 className="h-3.5 w-3.5" /> Rollback
            </Button>
          </>
        )}
        {r.lifecycle_state === "verified" && (
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => transition("rolled_back", { rollback_reason: "Post-verification rollback" })} className="gap-1.5 border-sev-high/40 text-sev-high hover:bg-sev-high/10">
            <Undo2 className="h-3.5 w-3.5" /> Rollback
          </Button>
        )}

        <button
          type="button"
          onClick={() => setShowTrail((v) => !v)}
          className="ml-auto flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary"
        >
          {showTrail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Evidence trail ({events.length})
        </button>
      </div>

      {showTrail && (
        <div className="border-t border-border/60 px-3 py-3 space-y-2 bg-background/30">
          {events.length === 0 && <div className="text-xs text-muted-foreground font-mono">No events recorded yet.</div>}
          {events.map((e) => (
            <div key={e.id} className="rounded-md border border-border/60 bg-card/60 px-3 py-2 text-[11px] font-mono">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-primary uppercase tracking-wider">{e.event_type}</span>
                <span className="text-muted-foreground">{new Date(e.created_at).toISOString()}</span>
              </div>
              <div className="mt-1 text-muted-foreground">actor: <span className="text-foreground">{e.actor_id?.slice(0, 8) ?? "system"}</span></div>
              {e.command && <div className="mt-1 text-foreground/80 break-all">$ {e.command}</div>}
              {(e.before_state || e.after_state) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted-foreground hover:text-primary">before / after state</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background/60 p-2 text-[10px]">{JSON.stringify({ before: e.before_state, after: e.after_state, verification: e.verification }, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActorCell({ label, id, ts }: { label: string; id?: string | null; ts?: string | null }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-1 text-foreground/90">
        <UserIcon className="h-3 w-3 text-muted-foreground" />
        <span className="truncate">{id ? id.slice(0, 8) : "—"}</span>
      </div>
      <div className="text-[9px] text-muted-foreground mt-0.5">{ts ? new Date(ts).toLocaleString() : "pending"}</div>
    </div>
  );
}