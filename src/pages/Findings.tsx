import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { SEV_RING, type Severity } from "@/lib/severity";

export default function Findings() {
  const [rows, setRows] = useState<any[]>([]);
  const [sev, setSev] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("findings").select("*").order("created_at", { ascending: false }).limit(500);
      setRows(data ?? []);
    })();
  }, []);

  const filtered = sev === "all" ? rows : rows.filter((r) => r.severity === sev);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <div className="text-xs font-mono text-muted-foreground">findings</div>
          <h1 className="font-display text-3xl font-bold">Findings</h1>
        </div>

        <div className="flex gap-2">
          {(["all", "critical", "high", "medium", "low", "info"] as const).map((s) => (
            <button key={s} onClick={() => setSev(s)}
              className={`text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
                sev === s ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/40"
              }`}>{s}</button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && <div className="text-sm text-muted-foreground">No findings.</div>}
          {filtered.map((f) => (
            <div key={f.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_RING[f.severity as Severity] ?? ""}`}>
                      {f.severity}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">{f.service}</span>
                    <span className="text-xs font-mono text-muted-foreground">· {f.check_id}</span>
                  </div>
                  <div className="mt-1.5 font-medium">{f.title}</div>
                  {f.description && <div className="text-sm text-muted-foreground mt-1">{f.description}</div>}
                  {f.resource_arn && <div className="mt-2 text-xs font-mono text-muted-foreground truncate">{f.resource_arn}</div>}
                </div>
                <div className="text-xs font-mono text-muted-foreground whitespace-nowrap">{f.region ?? ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}