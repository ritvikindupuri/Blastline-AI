export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export const SEV_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const SEV_RING: Record<Severity, string> = {
  critical: "ring-sev-critical/40 text-sev-critical bg-sev-critical/10 border-sev-critical/30",
  high: "ring-sev-high/40 text-sev-high bg-sev-high/10 border-sev-high/30",
  medium: "ring-sev-medium/40 text-sev-medium bg-sev-medium/10 border-sev-medium/30",
  low: "ring-sev-low/40 text-sev-low bg-sev-low/10 border-sev-low/30",
  info: "ring-sev-info/40 text-sev-info bg-sev-info/10 border-sev-info/30",
};

export const SEV_DOT: Record<Severity, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
  info: "bg-sev-info",
};

import {
  Radar,
  ScanSearch,
  Crosshair,
  Flame,
  Wrench,
  Scale,
  ClipboardList,
  Bot,
  type LucideIcon,
} from "lucide-react";

export type AgentMeta = {
  label: string;
  color: string;
  ring: string;
  Icon: LucideIcon;
};

export const AGENT_META: Record<string, AgentMeta> = {
  recon:        { label: "Recon",        color: "text-primary",        ring: "border-primary/40 bg-primary/10",         Icon: Radar },
  misconfig:    { label: "Misconfig",    color: "text-accent",         ring: "border-accent/40 bg-accent/10",           Icon: ScanSearch },
  attackpath:   { label: "AttackPath",   color: "text-sev-critical",   ring: "border-sev-critical/40 bg-sev-critical/10", Icon: Crosshair },
  blastradius:  { label: "BlastRadius",  color: "text-sev-high",       ring: "border-sev-high/40 bg-sev-high/10",       Icon: Flame },
  remediation:  { label: "Remediation", color: "text-success",        ring: "border-success/40 bg-success/10",         Icon: Wrench },
  critic:       { label: "Critic",       color: "text-sev-medium",     ring: "border-sev-medium/40 bg-sev-medium/10",   Icon: Scale },
  reporter:     { label: "Reporter",     color: "text-primary-glow",   ring: "border-primary/40 bg-primary/10",         Icon: ClipboardList },
};

export const FALLBACK_AGENT: AgentMeta = {
  label: "Agent",
  color: "text-foreground",
  ring: "border-border bg-background/50",
  Icon: Bot,
};