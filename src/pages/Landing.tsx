import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Activity, Network, GitBranch, ScanSearch, Bot, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import logo from "@/assets/vaultline-logo.png";

const agents = [
  { icon: ScanSearch, name: "Recon", desc: "Enumerates IAM, S3, EC2, Lambda, RDS, CloudTrail and GuardDuty across regions." },
  { icon: ShieldCheck, name: "Misconfig", desc: "Runs CIS AWS Foundations + NIST 800-53 checks against the recon graph." },
  { icon: Network, name: "AttackPath", desc: "Chains findings into realistic privilege-escalation paths." },
  { icon: Activity, name: "BlastRadius", desc: "Quantifies blast radius — resources, data classes, business tier." },
  { icon: GitBranch, name: "Remediation", desc: "Emits Terraform + AWS CLI fixes per finding." },
  { icon: Bot, name: "Critic", desc: "An adversarial agent challenges every finding to kill false positives." },
];

export default function Landing() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/40 to-background" />

      <header className="relative z-10 flex items-center justify-between px-8 h-16 border-b border-border/60 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Vaultline" width={24} height={24} className="h-6 w-6" />
          <span className="font-display font-semibold tracking-tight">Vaultline</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/auth?mode=signin"><Button variant="ghost" size="sm">Sign in</Button></Link>
          <Link to="/auth?mode=signup"><Button size="sm" className="shadow-glow">Sign up</Button></Link>
        </div>
      </header>

      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-mono text-muted-foreground mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />
          6-agent orchestration · live AWS introspection
        </div>
        <h1 className="font-display text-6xl md:text-7xl font-bold leading-[1.02] tracking-tight">
          Your AWS account, <br />
          <span className="text-primary text-glow">interrogated by AI.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Vaultline runs a fleet of specialized agents across your AWS environment to uncover
          misconfigurations, chain them into attack paths, score blast radius, and ship Terraform fixes — in minutes.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link to="/auth?mode=signup"><Button size="lg" className="gap-2 shadow-glow">Start an audit <ArrowRight className="h-4 w-4" /></Button></Link>
          <a href="#agents"><Button size="lg" variant="outline">See the agents</Button></a>
        </div>
        <div className="mt-8 flex items-center justify-center gap-6 text-xs text-muted-foreground font-mono">
          {["Read-only IAM role", "No exploits", "CIS · NIST · MITRE"].map((t) => (
            <div key={t} className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-success" /> {t}</div>
          ))}
        </div>
      </section>

      <section id="agents" className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="text-xs font-mono text-primary uppercase tracking-widest">// the agents</div>
          <h2 className="font-display text-4xl font-bold mt-2">Six minds. One verdict.</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {agents.map((a) => (
            <div key={a.name} className="group relative rounded-xl border border-border bg-card/60 backdrop-blur p-5 hover:border-primary/40 transition-colors shadow-card">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                  <a.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="font-display font-semibold">{a.name}</div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-border/60 py-8 text-center text-xs text-muted-foreground font-mono">
        Vaultline · defensive security operations · {new Date().getFullYear()}
      </footer>
    </div>
  );
}