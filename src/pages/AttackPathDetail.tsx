import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { SEV_RING, type Severity } from "@/lib/severity";
import { Button } from "@/components/ui/button";
import ReactFlow, { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, type NodeProps } from "reactflow";
import { ExternalLink, GitBranch, ShieldCheck, Terminal, Globe, KeyRound, Database, ServerCog, Cloud, Network as NetworkIcon, AlertTriangle, type LucideIcon } from "lucide-react";
import "reactflow/dist/style.css";

type GraphNodeData = {
  label: string;
  kind?: string;
  index?: number;
  active?: boolean;
  dimmed?: boolean;
  severity?: Severity;
};

const KIND_ICON: Record<string, LucideIcon> = {
  internet: Globe,
  external: Globe,
  identity: KeyRound,
  iam: KeyRound,
  user: KeyRound,
  role: KeyRound,
  data: Database,
  s3: Database,
  rds: Database,
  compute: ServerCog,
  ec2: ServerCog,
  lambda: ServerCog,
  cloud: Cloud,
  network: NetworkIcon,
  vpc: NetworkIcon,
  attack: AlertTriangle,
  exploit: AlertTriangle,
};

function pickIcon(kind?: string): LucideIcon {
  if (!kind) return GitBranch;
  const k = kind.toLowerCase();
  for (const key of Object.keys(KIND_ICON)) {
    if (k.includes(key)) return KIND_ICON[key];
  }
  return GitBranch;
}

const awsConsoleFor = (finding?: any, remediation?: any) => {
  if (remediation?.aws_console_url) return remediation.aws_console_url;
  const region = finding?.region || "us-east-1";
  const service = String(finding?.service || "").toLowerCase();
  if (service === "iam") return "https://console.aws.amazon.com/iam/home";
  if (service === "s3") return "https://s3.console.aws.amazon.com/s3/home";
  if (service === "ec2") return `https://${region}.console.aws.amazon.com/ec2/home?region=${region}`;
  if (service === "rds") return `https://${region}.console.aws.amazon.com/rds/home?region=${region}`;
  if (service === "lambda") return `https://${region}.console.aws.amazon.com/lambda/home?region=${region}`;
  if (service === "cloudtrail") return `https://${region}.console.aws.amazon.com/cloudtrail/home?region=${region}`;
  if (service === "guardduty") return `https://${region}.console.aws.amazon.com/guardduty/home?region=${region}`;
  return "https://console.aws.amazon.com/console/home";
};

function AttackNode({ data, selected }: NodeProps<GraphNodeData>) {
  const Icon = pickIcon(data.kind);
  const active = selected || data.active;
  return (
    <div
      className={`group relative w-[260px] rounded-lg border bg-card/95 backdrop-blur shadow-card transition-all duration-200 ${
        active
          ? "border-primary ring-2 ring-primary/40 shadow-glow scale-[1.02]"
          : data.dimmed
            ? "border-border/40 opacity-40"
            : "border-border hover:border-primary/60 hover:shadow-glow"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-background" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-primary !bg-primary" />

      {/* Header strip */}
      <div className={`flex items-center justify-between rounded-t-lg border-b px-3 py-1.5 ${active ? "border-primary/40 bg-primary/10" : "border-border/60 bg-background/40"}`}>
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-primary">
          <span className="tabular-nums">{String((data.index ?? 0) + 1).padStart(2, "0")}</span>
          <span className="text-muted-foreground">·</span>
          <span>{data.kind || "step"}</span>
        </div>
        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`} />
      </div>

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${active ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/60 text-muted-foreground group-hover:text-primary group-hover:border-primary/50"}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1 break-words font-mono text-[12px] leading-snug text-foreground">
          {data.label}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { attackNode: AttackNode };

export default function AttackPathDetail() {
  const { id } = useParams();
  const [path, setPath] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [remediations, setRemediations] = useState<any[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("attack_paths").select("*").eq("id", id).single();
      setPath(data);
      if (data?.finding_ids?.length) {
        const { data: f } = await supabase.from("findings").select("*").in("id", data.finding_ids);
        setFindings(f ?? []);
        const { data: r } = await supabase
          .from("remediations")
          .select("*")
          .in("finding_id", data.finding_ids)
          .order("created_at", { ascending: false });
        setRemediations(r ?? []);
      } else {
        setFindings([]);
        setRemediations([]);
      }
    })();
  }, [id]);

  const { nodes, edges } = useMemo(() => {
    const g = (path?.graph as any) ?? { nodes: [], edges: [] };
    const rawEdges = g.edges ?? [];
    const activeNodeIds = new Set<string>();
    const activeEdgeIds = new Set<string>();

    if (hoveredEdgeId) {
      const edge = rawEdges.find((e: any, i: number) => String(e.id ?? i) === hoveredEdgeId);
      if (edge) {
        activeEdgeIds.add(hoveredEdgeId);
        activeNodeIds.add(String(edge.source));
        activeNodeIds.add(String(edge.target));
      }
    }

    if (hoveredNodeId) {
      activeNodeIds.add(hoveredNodeId);
      rawEdges.forEach((e: any, i: number) => {
        if (String(e.source) === hoveredNodeId || String(e.target) === hoveredNodeId) {
          activeEdgeIds.add(String(e.id ?? i));
          activeNodeIds.add(String(e.source));
          activeNodeIds.add(String(e.target));
        }
      });
    }

    const hasHover = Boolean(hoveredNodeId || hoveredEdgeId);
    // Auto-layout into a left→right chain when explicit positions aren't provided
    const rawNodes = g.nodes ?? [];
    const nodes = rawNodes.map((n: any, i: number) => {
      const nodeId = String(n.id ?? i);
      const active = activeNodeIds.has(nodeId);
      const fallbackPos = { x: i * 320, y: 60 + ((i % 2 === 0 ? 0 : 40)) };
      return {
        id: nodeId,
        type: "attackNode",
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: n.label ?? n.id ?? `node-${i}`, kind: n.kind, index: i, active, dimmed: hasHover && !active },
        position: n.position ?? fallbackPos,
      };
    });
    const edges = rawEdges.map((e: any, i: number) => {
      const edgeId = String(e.id ?? i);
      const active = activeEdgeIds.has(edgeId);
      const dimmed = hasHover && !active;
      return {
        id: edgeId,
        source: String(e.source),
        target: String(e.target),
        label: e.label,
        type: "smoothstep",
        animated: active,
        interactionWidth: 28,
        markerEnd: { type: MarkerType.ArrowClosed, color: active ? "hsl(36 100% 50%)" : "hsl(215 15% 55%)", width: 18, height: 18 },
        style: { stroke: active ? "hsl(36 100% 50%)" : "hsl(215 15% 55%)", strokeWidth: active ? 2.5 : 1.5, opacity: dimmed ? 0.2 : 0.95, strokeDasharray: active ? "0" : "5 4" },
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "hsl(215 51% 12%)", fillOpacity: 0.95, stroke: active ? "hsl(36 100% 50%)" : "hsl(215 35% 22%)", strokeWidth: 1 },
        labelStyle: { fill: active ? "hsl(36 100% 60%)" : "hsl(215 15% 80%)", fontSize: 10, fontFamily: "IBM Plex Mono, monospace", fontWeight: 600, textTransform: "uppercase" as const },
      };
    });
    return { nodes, edges };
  }, [path, hoveredNodeId, hoveredEdgeId]);

  if (!path) return <AppShell><div className="text-muted-foreground">Loading…</div></AppShell>;

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_RING[path.severity as Severity] ?? ""}`}>{path.severity}</span>
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Verified attack path</span>
            </div>
            <h1 className="mt-3 font-display text-3xl md:text-4xl font-bold tracking-tight">{path.title}</h1>
            {path.narrative && <p className="mt-3 text-sm md:text-base text-muted-foreground leading-relaxed">{path.narrative}</p>}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center lg:min-w-72">
            <div className="rounded-md border border-border bg-card/60 p-3"><div className="font-display text-xl font-bold">{nodes.length}</div><div className="text-[10px] font-mono uppercase text-muted-foreground">steps</div></div>
            <div className="rounded-md border border-border bg-card/60 p-3"><div className="font-display text-xl font-bold">{edges.length}</div><div className="text-[10px] font-mono uppercase text-muted-foreground">links</div></div>
            <div className="rounded-md border border-border bg-card/60 p-3"><div className="font-display text-xl font-bold">{findings.length}</div><div className="text-[10px] font-mono uppercase text-muted-foreground">findings</div></div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card/40 shadow-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-primary">Interactive attack graph</div>
              <div className="text-xs text-muted-foreground">Hover nodes or arrows to isolate the linked attack segment; drag, zoom, and pan to inspect the chain.</div>
            </div>
            <GitBranch className="h-5 w-5 text-primary" />
          </div>
          <div className="relative h-[640px] bg-[radial-gradient(circle_at_30%_20%,hsl(36_100%_50%/0.06),transparent_60%)]">
            {/* Legend overlay */}
            <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-md border border-border bg-card/90 backdrop-blur px-3 py-2 text-[10px] font-mono text-muted-foreground space-y-1">
              <div className="font-semibold text-foreground/80 uppercase tracking-wider mb-1">Legend</div>
              <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-6 bg-primary" /> active path</div>
              <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-6 border-t border-dashed border-muted-foreground" /> dependency</div>
              <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" /> hovered node</div>
            </div>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.22, duration: 600 }}
              minZoom={0.2}
              maxZoom={2}
              panOnScroll
              zoomOnPinch
              zoomOnDoubleClick
              connectionLineStyle={{ stroke: "hsl(var(--primary))", strokeWidth: 2 }}
              proOptions={{ hideAttribution: true }}
              onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
              onNodeMouseLeave={() => setHoveredNodeId(null)}
              onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
              onEdgeMouseLeave={() => setHoveredEdgeId(null)}
            >
              <Background variant={BackgroundVariant.Dots} color="hsl(215 35% 28%)" gap={22} size={1.2} />
              <MiniMap className="!bg-card !border !border-border !rounded-md" nodeColor={(n) => ((n.data as any)?.active ? "hsl(36 100% 50%)" : "hsl(215 15% 55%)")} maskColor="hsl(215 51% 12% / 0.78)" pannable zoomable />
              <Controls className="!bg-card !border-border !rounded-md overflow-hidden [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground hover:[&>button]:!bg-secondary" />
            </ReactFlow>
          </div>
        </section>

        {path.blast_radius && (
          <section className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-primary"><ShieldCheck className="h-4 w-4" /> Blast radius</div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-4 text-xs font-mono leading-relaxed text-foreground/90">{JSON.stringify(path.blast_radius, null, 2)}</pre>
          </section>
        )}

        <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div>
            <h3 className="font-display text-xl font-semibold mb-3">Chained findings ({findings.length})</h3>
            <div className="space-y-2">
              {findings.map((f) => (
                <div id={`finding-${f.id}`} key={f.id} className="rounded-lg border border-border bg-card/60 p-4 shadow-card scroll-mt-24">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_RING[f.severity as Severity] ?? ""}`}>{f.severity}</span>
                    <span className="text-xs font-mono text-muted-foreground">{f.service} · {f.check_id}</span>
                  </div>
                  <div className="mt-2 font-medium leading-snug">{f.title}</div>
                  {f.resource_arn && <div className="mt-2 text-xs font-mono text-muted-foreground break-all">{f.resource_arn}</div>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-display text-xl font-semibold mb-3">Remediation execution ({remediations.length})</h3>
            <div className="space-y-3">
              {remediations.length === 0 && <div className="rounded-lg border border-border bg-card/60 p-4 text-sm text-muted-foreground">No remediation execution evidence has been recorded for this path.</div>}
              {remediations.map((r) => {
                const finding = findings.find((f) => f.id === r.finding_id);
                const sourceNode = nodes.find((node) => {
                  const label = String(node.data?.label ?? "").toLowerCase();
                  return label.includes(String(finding?.check_id ?? "").toLowerCase()) || label.includes(String(finding?.service ?? "").toLowerCase());
                });
                const changes = r.aws_changes ?? { status: r.execution_status ?? "not_applied", resource: finding?.resource_arn ?? "pending", result: r.applied ? "Remediation marked applied" : "Awaiting approval or execution" };
                return (
                  <div key={r.id} className="rounded-lg border border-border bg-card/60 p-4 shadow-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-primary"><Terminal className="h-4 w-4" /> {r.fix_type} · {r.execution_status ?? "not_applied"}</div>
                        <div className="mt-2 font-medium">{r.title}</div>
                        {r.description && <div className="mt-1 text-sm text-muted-foreground">{r.description}</div>}
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                          <a className="rounded border border-border bg-background/60 px-2 py-1 hover:border-primary hover:text-primary" href={`#finding-${finding?.id ?? ""}`}>Source finding: {finding?.service ?? "AWS"} · {finding?.check_id ?? "unknown"}</a>
                          <span className="rounded border border-border bg-background/60 px-2 py-1">Path: {path.title}</span>
                          {sourceNode && (
                            <button
                              className="rounded border border-border bg-background/60 px-2 py-1 hover:border-primary hover:text-primary"
                              onMouseEnter={() => setHoveredNodeId(sourceNode.id)}
                              onMouseLeave={() => setHoveredNodeId(null)}
                              type="button"
                            >
                              Component: graph step {String((sourceNode.data?.index ?? 0) + 1).padStart(2, "0")}
                            </button>
                          )}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline" className="gap-2 border-border bg-transparent hover:bg-secondary">
                        <a href={awsConsoleFor(finding, r)} target="_blank" rel="noreferrer">Review in AWS <ExternalLink className="h-3.5 w-3.5" /></a>
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Executed script</div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed">{r.executed_script || r.snippet}</pre>
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Agent output</div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed">{r.execution_output || "Remediation has not been executed from Trace yet."}</pre>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">AWS account changes</div>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed">{JSON.stringify(changes, null, 2)}</pre>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
