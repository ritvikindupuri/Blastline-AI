import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { formatSyncedDate } from "@/lib/time";

export default function Audits() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("audits").select("*").order("created_at", { ascending: false });
      setRows(data ?? []);
    })();
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Execution History</div>
            <h1 className="font-display text-3xl font-bold">Audits</h1>
          </div>
          <Link to="/audits/new"><Button className="gap-2 shadow-glow"><Plus className="h-4 w-4" /> New Audit</Button></Link>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs font-mono uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">ID</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Started</th>
                <th className="text-left px-4 py-3">Findings</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No audits yet.</td></tr>
              )}
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-border hover:bg-secondary/20">
                  <td className="px-4 py-3 font-mono text-xs">{a.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                      a.status === "completed" ? "text-success border-success/30 bg-success/10" :
                      a.status === "failed" ? "text-sev-critical border-sev-critical/30 bg-sev-critical/10" :
                      "text-primary border-primary/30 bg-primary/10"
                    }`}>{a.status}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{formatSyncedDate(a.started_at)}</td>
                  <td className="px-4 py-3 font-mono">{(a.summary as any)?.total ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/audits/${a.id}`}><Button size="sm" variant="outline">View</Button></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}