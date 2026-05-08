import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { SEV_RING, type Severity } from "@/lib/severity";
import { Button } from "@/components/ui/button";
import ReactFlow, { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, type NodeProps, type Edge, type Node } from "reactflow";
import { GitBranch, ShieldCheck, Terminal, Globe, KeyRound, Database, ServerCog, Cloud, Network as NetworkIcon, AlertTriangle, X, ChevronRight, type LucideIcon } from "lucide-react";
import "reactflow/dist/style.css";
import { RemediationLifecycle } from "@/components/RemediationLifecycle";
import { RemediationFailureSheet } from "@/components/RemediationFailureSheet";
import dagre from "dagre";

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

function AttackNode({ data, selected }: NodeProps<GraphNodeData>) {
  const Icon = pickIcon(data.kind);
  const active = selected || data.active;
  const sevColor =
    data.severity === "critical" ? "hsl(var(--critical))"
    : data.severity === "high" ? "hsl(var(--high))"
    : data.severity === "medium" ? "hsl(var(--medium))"
    : data.severity === "low" ? "hsl(var(--low))"
    : "hsl(var(--muted-foreground))";

  return (
    <div
      className={`group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-2 bg-card shadow-card transition-all duration-300 ${
        active
          ? "border-primary shadow-[0_0_15px_rgba(var(--primary),0.5)] scale-110 z-10"
          : data.dimmed
            ? "border-border/30 opacity-40 scale-95"
            : "border-border hover:border-primary/50 hover:scale-105"
      }`}
      style={{
        borderColor: active ? undefined : sevColor,
        backgroundColor: active ? "hsl(var(--primary)/0.1)" : undefined
      }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />

      <Icon
        className={`h-6 w-6 transition-colors duration-300 ${active ? "text-primary" : ""}`}
        style={{ color: active ? undefined : sevColor }}
      />

      {/* Tooltip on hover/active */}
      <div
        className={`absolute -bottom-8 left-1/2 flex -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px] font-mono text-popover-foreground shadow-md transition-opacity duration-200 pointer-events-none ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <span className="font-bold mr-1">#{String((data.index ?? 0) + 1).padStart(2, "0")}</span>
        {data.kind || "step"}
      </div>
    </div>
  );
}

const nodeTypes = { attackNode: AttackNode };

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = "TB") => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // node width and height
  const nodeWidth = 70;
  const nodeHeight = 90; // extra height to account for the tooltip below it

  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      targetPosition: direction === "TB" ? Position.Top : Position.Left,
      sourcePosition: direction === "TB" ? Position.Bottom : Position.Right,
      // We are shifting the dagre node position (anchor=center center) to the top left
      // so it matches the React Flow node anchor point (top left).
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
    return newNode;
  });

  return { nodes: newNodes, edges };
};

export default function AttackPathDetail() {
  const { id } = useParams();
  const [path, setPath] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [remediations, setRemediations] = useState<any[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [requireSeparateApprover, setRequireSeparateApprover] = useState(false);

  async function reload() {
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
      // Look up the connection through the audit to read require_separate_approver
      if (data?.audit_id) {
        const { data: aud } = await supabase.from("audits").select("connection_id").eq("id", data.audit_id).single();
        if (aud?.connection_id) {
          const { data: conn } = await supabase.from("aws_connections").select("require_separate_approver").eq("id", aud.connection_id).single();
          setRequireSeparateApprover(Boolean(conn?.require_separate_approver));
        }
      }
    } else {
      setFindings([]);
      setRemediations([]);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const rawNodes = g.nodes ?? [];
    const initialNodes: Node[] = rawNodes.map((n: any, i: number) => {
      const nodeId = String(n.id ?? i);
      const active = activeNodeIds.has(nodeId);
      return {
        id: nodeId,
        type: "attackNode",
        data: { label: n.label ?? n.id ?? `node-${i}`, kind: n.kind, index: i, active, dimmed: hasHover && !active, severity: n.severity ?? path?.severity },
        position: { x: 0, y: 0 }, // Position will be overwritten by dagre
      };
    });

    const initialEdges: Edge[] = rawEdges.map((e: any, i: number) => {
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
        markerEnd: { type: MarkerType.ArrowClosed, color: active ? "hsl(36 100% 50%)" : "hsl(215 15% 55%)", width: 22, height: 22 },
        style: { stroke: active ? "hsl(36 100% 50%)" : "hsl(215 25% 45%)", strokeWidth: active ? 2.5 : 1.5, opacity: dimmed ? 0.2 : 0.8 },
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "hsl(215 51% 12%)", fillOpacity: 0.95, stroke: active ? "hsl(36 100% 50%)" : "hsl(215 35% 22%)", strokeWidth: 1 },
        labelStyle: { fill: active ? "hsl(36 100% 60%)" : "hsl(215 15% 80%)", fontSize: 10, fontFamily: "IBM Plex Mono, monospace", fontWeight: 600, textTransform: "uppercase" as const },
      };
    });

    return getLayoutedElements(initialNodes, initialEdges, "TB");
  }, [path, hoveredNodeId, hoveredEdgeId]);

  if (!path) return <AppShell><div className="text-muted-foreground">Loading…</div></AppShell>;

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const selectedRaw = selectedNodeId ? ((path.graph as any)?.nodes ?? []).find((n: any, i: number) => String(n.id ?? i) === selectedNodeId) : null;
  const selectedIncoming = selectedNodeId ? edges.filter((e) => e.target === selectedNodeId) : [];
  const selectedOutgoing = selectedNodeId ? edges.filter((e) => e.source === selectedNodeId) : [];

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
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-foreground/80">
                <GitBranch className="h-3.5 w-3.5 text-primary" /> attack graph
                <span className="text-border">|</span>
                <span className="text-muted-foreground">{nodes.length} nodes · {edges.length} edges</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--critical))" }} /> critical</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--high))" }} /> high</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--medium))" }} /> medium</span>
            </div>
          </div>
          <div className="relative grid h-[520px] grid-cols-[1fr_320px]">
            <div className="relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.15, duration: 600, maxZoom: 1.1 }}
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
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
            >
              <Background variant={BackgroundVariant.Lines} color="hsl(215 35% 22%)" gap={32} lineWidth={0.5} />
              <MiniMap className="!bg-card !border !border-border !rounded-md" nodeColor={(n) => {
                const sev = (n.data as any)?.severity;
                if (sev === "critical") return "hsl(var(--critical))";
                if (sev === "high") return "hsl(var(--high))";
                if (sev === "medium") return "hsl(var(--medium))";
                return "hsl(215 15% 55%)";
              }} maskColor="hsl(215 51% 12% / 0.78)" pannable zoomable />
              <Controls className="!bg-card !border-border !rounded-md overflow-hidden [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground hover:[&>button]:!bg-secondary" />
            </ReactFlow>
            </div>
            {/* Inspector */}
            <aside className="border-l border-border bg-card/60 overflow-y-auto">
              {!selectedNode && (
                <div className="p-4 text-xs text-muted-foreground space-y-2">
                  <div className="font-mono uppercase tracking-wider text-foreground/80">Inspector</div>
                  <p>Click any node in the graph to inspect its kind, severity, evidence, and adjacent edges.</p>
                  <div className="mt-4 space-y-1.5 text-[10px] font-mono uppercase tracking-wider">
                    <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-6 bg-primary" /> active path</div>
                    <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-6 bg-muted-foreground/60" /> dependency</div>
                  </div>
                </div>
              )}
              {selectedNode && (
                <div className="p-4 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Step #{String((selectedNode.data?.index ?? 0) + 1).padStart(2, "0")} · {selectedRaw?.kind || "node"}</div>
                      <div className="mt-1 font-mono text-sm text-foreground break-words">{selectedNode.data?.label}</div>
                    </div>
                    <button onClick={() => setSelectedNodeId(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                  </div>
                  {selectedRaw?.evidence && (
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Evidence</div>
                      <pre className="rounded border border-border bg-background/60 p-2 text-[10px] font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto">{typeof selectedRaw.evidence === "string" ? selectedRaw.evidence : JSON.stringify(selectedRaw.evidence, null, 2)}</pre>
                    </div>
                  )}
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Incoming ({selectedIncoming.length})</div>
                    <div className="space-y-1">
                      {selectedIncoming.length === 0 && <div className="text-xs text-muted-foreground">— entry node</div>}
                      {selectedIncoming.map((e) => {
                        const src = nodes.find((n) => n.id === e.source);
                        return <div key={e.id} className="flex items-center gap-1.5 rounded border border-border bg-background/40 px-2 py-1 text-[11px] font-mono"><ChevronRight className="h-3 w-3 text-primary rotate-180" /><span className="truncate">{src?.data?.label ?? e.source}</span></div>;
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Outgoing ({selectedOutgoing.length})</div>
                    <div className="space-y-1">
                      {selectedOutgoing.length === 0 && <div className="text-xs text-muted-foreground">— terminal node</div>}
                      {selectedOutgoing.map((e) => {
                        const tgt = nodes.find((n) => n.id === e.target);
                        return <div key={e.id} className="flex items-center gap-1.5 rounded border border-border bg-background/40 px-2 py-1 text-[11px] font-mono"><ChevronRight className="h-3 w-3 text-primary" /><span className="truncate">{tgt?.data?.label ?? e.target}</span></div>;
                      })}
                    </div>
                  </div>
                </div>
              )}
            </aside>
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
                        <a href={awsConsoleFor(finding, r)} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openAwsConsoleUrl(awsConsoleFor(finding, r)); }}>Review in AWS <ExternalLink className="h-3.5 w-3.5" /></a>
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Executed script</div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed">{r.executed_script || r.snippet}</pre>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                          <span>Agent output</span>
                          <span className="rounded border border-border px-1.5 py-0.5 text-[9px]">{(r.execution_status || "not_applied").replace(/_/g, " ")}</span>
                        </div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed text-muted-foreground">{r.execution_output || "No execution output yet — this remediation is a proposed fix. Approve and run it from the Remediations page to apply it to your AWS account, or copy the snippet above and apply it manually."}</pre>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">AWS account changes</div>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed">{JSON.stringify(changes, null, 2)}</pre>
                    </div>
                    <RemediationLifecycle
                      remediation={r}
                      currentUserId={currentUserId}
                      requireSeparateApprover={requireSeparateApprover}
                      onChange={reload}
                    />
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
