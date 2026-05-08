import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Sparkles, CheckCircle2, Loader2 } from "lucide-react";

type Props = {
  remediation: any;
  onApproved?: () => void;
};

export function RemediationFailureSheet({ remediation, onApproved }: Props) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const analysis = remediation?.aws_changes?.ai_failure_analysis;
  if (!analysis) return null;

  const hasProposal = !!analysis.proposed_snippet;

  async function approveAndUse() {
    if (!analysis?.proposed_snippet) return;
    setBusy(true);
    try {
      const newChanges = { ...(remediation.aws_changes || {}), ai_failure_analysis: null };
      const { error } = await supabase
        .from("remediations")
        .update({
          snippet: analysis.proposed_snippet,
          executed_script: analysis.proposed_snippet,
          execution_status: "not_applied",
          aws_changes: newChanges,
        })
        .eq("id", remediation.id);
      if (error) throw error;
      setOpen(false);
      onApproved?.();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 border-sev-critical/40 bg-sev-critical/5 text-sev-critical hover:bg-sev-critical/10">
          <Sparkles className="h-3.5 w-3.5" /> AI failure analysis
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-sev-critical" />
            AI failure analysis
          </SheetTitle>
          <SheetDescription>
            The execution log on the left is the official AWS console output. Below is the AI's analysis of why it failed and a proposed fix you can review and approve before re-running.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4 text-sm">
          {analysis.failed_action && (
            <div className="rounded-md border border-border bg-background/40 p-3 font-mono text-xs">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Failed AWS API</div>
              <div className="text-sev-critical">{analysis.failed_action}</div>
              {analysis.aws_error && (
                <div className="mt-2 text-foreground/80 break-words whitespace-pre-wrap">{analysis.aws_error}</div>
              )}
            </div>
          )}

          {analysis.analysis_error && (
            <div className="rounded-md border border-sev-high/40 bg-sev-high/10 p-3 text-xs font-mono text-sev-high">
              {analysis.analysis_error}
            </div>
          )}

          {analysis.explanation && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-primary mb-1 font-mono">AI explanation</div>
              <div className="text-foreground/90 whitespace-pre-wrap">{analysis.explanation}</div>
            </div>
          )}

          {hasProposal && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">Proposed refined snippet</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-success/40 bg-success/5 p-3 text-xs font-mono leading-relaxed">{analysis.proposed_snippet}</pre>
            </div>
          )}

          {analysis.original_snippet && (
            <details>
              <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground font-mono hover:text-primary">Original snippet (that failed)</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-3 text-xs font-mono leading-relaxed text-muted-foreground">{analysis.original_snippet}</pre>
            </details>
          )}

          {hasProposal && (
            <div className="flex flex-col gap-2 pt-3 border-t border-border">
              <Button onClick={approveAndUse} disabled={busy} className="gap-2 bg-success text-success-foreground hover:bg-success/90">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve & use this snippet
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Approving will replace the current snippet with the proposed one and reset the remediation so you can click Apply again to re-run with the fix.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}