import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { SEV_RING, type Severity } from "@/lib/severity";
import { Network } from "lucide-react";

export default function AttackPaths() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("attack_paths").select("*").order("created_at", { ascending: false });
      setRows(data ?? []);
    })();
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <div className="text-xs font-mono text-muted-foreground">// chained risk</div>
          <h1 className="font-display text-3xl font-bold">Attack Paths</h1>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {rows.length === 0 && <div className="text-sm text-muted-foreground">No attack paths discovered yet.</div>}
          {rows.map((p) => (
            <Link key={p.id} to={`/attack-paths/${p.id}`}
              className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card hover:border-primary/40 transition-colors">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-sev-critical" />
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_RING[p.severity as Severity] ?? ""}`}>{p.severity}</span>
              </div>
              <div className="font-display font-semibold mt-2">{p.title}</div>
              {p.narrative && <div className="text-sm text-muted-foreground mt-1 line-clamp-3">{p.narrative}</div>}
              <div className="mt-3 text-xs font-mono text-muted-foreground">{p.finding_ids?.length ?? 0} findings chained</div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}