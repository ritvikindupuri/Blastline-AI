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

export const AGENT_META: Record<string, { label: string; color: string; icon: string }> = {
  recon: { label: "Recon", color: "text-primary", icon: "🛰️" },
  misconfig: { label: "Misconfig", color: "text-accent", icon: "🔍" },
  attackpath: { label: "AttackPath", color: "text-sev-critical", icon: "⚡" },
  blastradius: { label: "BlastRadius", color: "text-sev-high", icon: "💥" },
  remediation: { label: "Remediation", color: "text-success", icon: "🛠️" },
  critic: { label: "Critic", color: "text-sev-medium", icon: "⚖️" },
  reporter: { label: "Reporter", color: "text-primary-glow", icon: "📋" },
};