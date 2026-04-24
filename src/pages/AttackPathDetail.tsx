import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { SEV_RING, type Severity } from "@/lib/severity";
import ReactFlow, { Background, Controls, MarkerType } from "reactflow";
import "reactflow/dist/style.css";

export default function AttackPathDetail() {
  const { id } = useParams();
  const [path, setPath] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("attack_paths").select("*").eq("id", id).single();
      setPath(data);
      if (data?.finding_ids?.length) {
        const { data: f } = await supabase.from("findings").select("*").in("id", data.finding_ids);
        setFindings(f ?? []);
      }
    })();
  }, [id]);

  const { nodes, edges } = useMemo(() => {
    const g = (path?.graph as any) ?? { nodes: [], edges: [] };
    const nodes = (g.nodes ?? []).map((n: any, i: number) => ({
      id: String(n.id ?? i),
      data: { label: n.label ?? n.id ?? `node-${i}` },
      position: n.position ?? { x: i * 220, y: (i % 2) * 120 },
      style: {
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--primary) / 0.4)",
        color: "hsl(var(--foreground))",
        borderRadius: 8,
        padding: 8,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 12,
      },
    }));
    const edges = (g.edges ?? []).map((e: any, i: number) => ({
      id: String(e.id ?? i),
      source: String(e.source),
      target: String(e.target),
      label: e.label,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
      style: { stroke: "hsl(var(--primary))" },
      labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
    }));
    return { nodes, edges };
  }, [path]);

  if (!path) return <AppShell><div className="text-muted-foreground">Loading‚Ä¶</div></AppShell>;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Link to="/attack-paths" className="text-xs font-mono text-muted-foreground hover:text-primary">ˇÜê all paths</Link>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_RING[path.severity as Severity] ?? ""}`}>{path.severity}</span>
            <h1 className="font-display text-3xl font-bold">{path.title}</h1>
          </div>
          {path.narrative && <p className="text-muted-foreground mt-2 max-w-3xl">{path.narrative}</p>}
        </div>

        <div className="rounded-xl border border-border bg-card/40 backdrop-blur shadow-card overflow-hidden" style={{ height: 480 }}>
          <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
            <Background color="hsl(var(--border))" gap={24} />
            <Controls className="!bg-card !border-border" />
          </ReactFlow>
        </div>

        {path.blast_radius && (
          <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
            <div className="text-xs font-mono text-muted-foreground">Blast radius</div>
            <pre className="mt-2 text-xs font-mono whitespace-pre-wrap text-foreground/90">{JSON.stringify(path.blast_radius, null, 2)}</pre>
          </div>
        )}

        <div>
          <h3 className="font-display font-semibold mb-3">Chained findings ({findings.length})</h3>
          <div className="space-y-2">
            {findings.map((f) => (
              <div key={f.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-4">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_RING[f.severity as Severity] ?? ""}`}>{f.severity}</span>
                  <span className="text-xs font-mono text-muted-foreground">{f.service} ¬∑ {f.check_id}</span>
                </div>
                <div className="mt-1 font-medium">{f.title}</div>
                {f.resource_arn && <div className="mt-1 text-xs font-mono text-muted-foreground truncate">{f.resource_arn}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}